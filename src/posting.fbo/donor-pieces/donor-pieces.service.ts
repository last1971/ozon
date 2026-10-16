import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommandChainAsync } from '../../helpers/command/command.chain.async';
import { inTransaction } from '../../helpers/transaction';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { NotifyTopic } from '../../notify/notify.types';
import { DonorPiecesInvoiceRefDto, DonorPiecesSummaryDto } from '../dto/donor-pieces.dto';
import { LoadDonorsCommand } from './commands/load-donors.command';
import { FetchSuppliesCommand } from './commands/fetch-supplies.command';
import { MatchSuppliesCommand } from './commands/match-supplies.command';
import { WritePiecesCommand } from './commands/write-pieces.command';
import { JournalOutcomesCommand } from './commands/journal-outcomes.command';
import { DonorPiecesContext, DonorPiecesInvoice, DonorPiecesResult } from './donor-pieces.types';

/**
 * Фасовка счетов-доноров FORFBO по составу поставки Озона — одна точка на кнопку экрана недоборов
 * и вечерний крон. Состав и порядок шагов известны только здесь:
 *  - чтение: доноры с пустой фасовкой → состав поставок из Озона → сопоставление (без транзакции —
 *    проход по сотне поставок не должен держать базу);
 *  - запись: фасовка + итог в журнал, одной транзакцией. Проверка без записи на неё не заходит.
 * Повтор безопасен: пишем только в пустое поле, заполненный счёт из выборки уходит сам.
 */
@Injectable()
export class DonorPiecesService {
    private readonly logger = new Logger(DonorPiecesService.name);
    /** Кнопка и крон в одном процессе: второй одновременный проход — 409, а не гонка за журнал. */
    private running = false;

    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly load: LoadDonorsCommand,
        private readonly fetch: FetchSuppliesCommand,
        private readonly match: MatchSuppliesCommand,
        private readonly write: WritePiecesCommand,
        private readonly journal: JournalOutcomesCommand,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    readChain(): CommandChainAsync<DonorPiecesContext> {
        return new CommandChainAsync<DonorPiecesContext>([this.load, this.fetch, this.match]);
    }

    writeChain(): CommandChainAsync<DonorPiecesContext> {
        return new CommandChainAsync<DonorPiecesContext>([this.write, this.journal]);
    }

    /** Кнопка: сводка на экран. Письма нет — человек видит итог сам, а журнал запомнит, что видено. */
    async run(dry: boolean): Promise<DonorPiecesSummaryDto> {
        return DonorPiecesService.summarize(dry, await this.execute(dry));
    }

    // 21:47 по серверу — после рабочего дня, когда новые поставки уже заведены; мимо пятиминуток (:00–:07, :20, :25).
    // Боевое время задаёт cron.setup.ts.
    @Cron('0 47 21 * * *', { name: 'fillDonorPieces' })
    async nightly(): Promise<void> {
        try {
            const results = await this.execute(false);
            const letter = DonorPiecesService.letter(results);
            if (letter) this.eventEmitter.emit('error.message', letter.subject, letter.body, NotifyTopic.OPS);
        } catch (e) {
            this.logger.error(`фасовка доноров не проставлена — ${e.message}`);
            this.eventEmitter.emit('error.message', 'Фасовка доноров FBO: проход не выполнен', e.message);
        }
    }

    private async execute(dry: boolean): Promise<DonorPiecesResult[]> {
        if (this.running) throw new ConflictException('Фасовка доноров уже проставляется — дождитесь конца прохода');
        this.running = true;
        try {
            const buyerId = Number(this.configService.get<number>('OZON_BUYER_ID', 24416));
            let ctx = await this.readChain().execute({ dry, buyerId });
            if (!dry && ctx.results?.length) {
                ctx = await inTransaction(
                    () => this.invoiceService.getTransaction(),
                    (t) => this.writeChain().execute({ ...ctx, t, stopChain: false }),
                );
            }
            const results = ctx.results ?? [];
            const s = DonorPiecesService.summarize(dry, results);
            this.logger.log(
                `[donor-pieces]${dry ? ' проверка:' : ''} счетов ${s.checked}, поставок найдено ${s.suppliesFound}, строк ${s.lines}, ` +
                    `сошлось ${s.done}, спорных ${s.disputes.length}, без номера ${s.noNumber.length}, ` +
                    `не найдено ${s.notFound.length}, ошибок Озона ${s.ozonErrors.length}`,
            );
            return results;
        } finally {
            this.running = false;
        }
    }

    private static ref(invoice: DonorPiecesInvoice): DonorPiecesInvoiceRefDto {
        return {
            invoiceNumber: invoice.invoiceNumber,
            scode: invoice.scode,
            prim: invoice.prim,
            supplyNumber: invoice.supplyNumber,
        };
    }

    static summarize(dry: boolean, results: DonorPiecesResult[]): DonorPiecesSummaryDto {
        const of = (outcome: DonorPiecesResult['outcome']) => results.filter((r) => r.outcome === outcome);
        return {
            dry,
            checked: results.length,
            suppliesFound: results.filter((r) => r.outcome === 'DONE' || r.outcome === 'DISPUTE').length,
            lines: results.reduce((sum, r) => sum + (dry ? r.fills.length : (r.written ?? 0)), 0),
            done: of('DONE').length,
            disputes: of('DISPUTE').flatMap((r) =>
                r.disputes.map((d) => ({ ...DonorPiecesService.ref(r.invoice), ...d })),
            ),
            noNumber: of('NO_NUMBER').map((r) => DonorPiecesService.ref(r.invoice)),
            notFound: of('NOT_FOUND').map((r) => DonorPiecesService.ref(r.invoice)),
            ozonErrors: of('OZON_ERROR').map((r) => ({ ...DonorPiecesService.ref(r.invoice), message: r.error ?? '' })),
        };
    }

    /** Письмо крона — только про итоги, которых журнал ещё не видел. Старые нерешённые — в сводке по кнопке. */
    static letter(results: DonorPiecesResult[]): { subject: string; body: string } | null {
        const fresh = results.filter((r) => r.isNew && r.outcome !== 'DONE');
        if (!fresh.length) return null;
        const lines: string[] = [];
        for (const r of fresh) {
            const head = `Счёт №${r.invoice.invoiceNumber} · ${r.invoice.prim}`;
            if (r.outcome === 'NO_NUMBER') lines.push(`${head}\n  в примечании нет номера поставки — допишите номер`);
            else if (r.outcome === 'NOT_FOUND') lines.push(`${head}\n  Озон не знает поставку ${r.invoice.supplyNumber}`);
            else lines.push(`${head}\n` + r.disputes.map((d) => `  ${d.goodscode}: ${d.reason}`).join('\n'));
        }
        return {
            subject: `Фасовка доноров FBO: разобрать руками ${fresh.length}`,
            body:
                'Фасовку этим счетам-донорам по поставке Озона проставить не удалось — она остаётся ' +
                'неизвестной, и подбор не отличит на них штучный товар от упаковок.\n\n' +
                lines.join('\n\n'),
        };
    }
}
