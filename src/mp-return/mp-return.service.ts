import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { IReturnStock, RETURN_STOCK } from '../interfaces/i.return.stock';
import { MpService } from '../mp-event/mp-event.service';
import { MpReturnAcceptStore } from '../mp-event/mp-return-accept.store';
import { parseReturnScan } from '../helpers/return-scan.parser';
import { NotifyTopic } from '../notify/notify.types';
import { IReturnSource, RETURN_SOURCES } from './sources/i.return.source';
import { ReturnCardBuilder } from './return-card.builder';
import { MpReturnChainFactory } from './mp-return.chain.factory';
import { ReturnRefusedError } from './return-refused.error';
import { returnRowStatus } from './assess-return-line';
import { ReturnLineDto } from './dto/return-line.dto';
import { ReturnCardDto, ReturnRowDto } from './dto/return-card.dto';
import { AcceptReturnDto, ReturnActionResultDto, WriteOffReturnDto } from './dto/return-request.dto';
import { AcceptContext } from './commands/return.contexts';

/** Блокировка записи кроном возвратов (раз в 5 минут правит те же коды). */
const LOCK_ERROR = /deadlock|lock conflict|concurrent update/i;
/** Список по умолчанию — за последние 14 дней (решение владельца 15.10). */
const DEFAULT_DAYS = 14;

/**
 * Экран приёма возвратов: список, поиск по скану, приём/проблема, списание.
 * Сервис держит транзакцию и переводит ошибки на язык кладовщика; что делать по шагам —
 * знает фабрика цепочек, можно ли — оценка строки возврата.
 */
@Injectable()
export class MpReturnService {
    private readonly logger = new Logger(MpReturnService.name);
    private readonly sources: Map<MpService, IReturnSource>;

    constructor(
        @Inject(RETURN_SOURCES) sources: IReturnSource[],
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        @Inject(RETURN_STOCK) private readonly stock: IReturnStock,
        private readonly builder: ReturnCardBuilder,
        private readonly store: MpReturnAcceptStore,
        private readonly factory: MpReturnChainFactory,
        private readonly eventEmitter: EventEmitter2,
    ) {
        this.sources = new Map(sources.map((s) => [s.service, s]));
    }

    async list(service: MpService, from?: string, to?: string, onlyPending = true): Promise<ReturnRowDto[]> {
        const source = this.source(service);
        const start = from
            ? DateTime.fromISO(from).startOf('day')
            : DateTime.now().minus({ days: DEFAULT_DAYS }).startOf('day');
        const end = (to ? DateTime.fromISO(to) : DateTime.now()).plus({ days: 1 }).startOf('day');
        if (!start.isValid || !end.isValid) throw new BadRequestException('Неверный период');
        const lines = await source.listReceived(start.toJSDate(), end.toJSDate());
        const rows = await this.read(async (t) => {
            const records = new Map(
                (
                    await this.store.findMany(
                        service,
                        lines.map((l) => l.extId),
                        t,
                    )
                ).map((r) => [r.extId, r]),
            );
            const result: ReturnRowDto[] = [];
            for (const line of lines) {
                const card = await this.builder.build(line, t, records.get(line.extId) ?? null);
                result.push({
                    line,
                    invoiceNumber: card.invoice?.number ?? null,
                    goodsName: card.invoiceLine?.name ?? line.productName,
                    quan: card.quan,
                    status: returnRowStatus(card.accepted, card.blockers),
                    blockers: card.blockers,
                    warnings: card.warnings,
                });
            }
            return result;
        });
        return onlyPending ? rows.filter((r) => r.status === 'pending' || r.status === 'blocked') : rows;
    }

    async lookup(service: MpService, q: string): Promise<ReturnCardDto[]> {
        const scan = parseReturnScan(q);
        if (!scan)
            throw new BadRequestException(
                `Не распознано: «${q}». Нужна этикетка возврата ii…, номер отправления или заказа`,
            );
        const lines = await this.source(service).find(scan);
        if (!lines.length) {
            throw new NotFoundException(
                scan.kind === 'barcode'
                    ? `Возврат ${scan.value} не найден. Если Ozon ещё не отметил посылку — повторите через 5 минут или введите номер отправления`
                    : `Возврат по «${scan.value}» не найден — возможно, посылка другого кабинета`,
            );
        }
        return this.read((t) => Promise.all(lines.map((line) => this.builder.build(line, t))));
    }

    async accept(service: MpService, extId: string, dto: AcceptReturnDto): Promise<ReturnActionResultDto> {
        const line = await this.resolveLine(service, extId, dto.posting);
        const ctx = await this.write((t) =>
            this.factory.forAction(dto.action).execute({
                t,
                line,
                action: dto.action,
                username: dto.username.trim(),
                scans: dto.scans ?? [],
                comment: dto.comment?.trim() || null,
                osnSpisId: dto.osnSpisId ?? null,
                kis: [],
                retiredKis: [],
            }),
        );
        this.notifyAccepted(ctx);
        return { ok: true, message: this.acceptMessage(ctx) };
    }

    async writeOff(service: MpService, extId: string, dto: WriteOffReturnDto): Promise<ReturnActionResultDto> {
        this.source(service);
        const result = await this.write(async (t) => {
            const rec = await this.store.find(service, extId, t);
            if (!rec || rec.decision !== 'RETURN')
                throw new ReturnRefusedError('Списать можно только принятый возврат');
            return this.factory.writeOff().execute({
                t,
                service,
                extId,
                posting: rec.posting ?? '',
                goodscode: rec.goodscode,
                quan: rec.quan,
                kis: rec.kis,
                username: dto.username.trim(),
                osnSpisId: dto.osnSpisId,
                comment: dto.comment?.trim() || null,
            });
        });
        this.eventEmitter.emit(
            'error.message',
            'Списан возврат',
            `${result.posting}: ${result.quan} шт, документ списания ${result.spisCode}, списал ${result.username}`,
            NotifyTopic.OPS,
        );
        return { ok: true, message: `Списано ${result.quan} шт, документ ${result.spisCode}` };
    }

    reasons(): Promise<{ id: number; name: string }[]> {
        return this.stock.listWriteOffReasons();
    }

    private source(service: MpService): IReturnSource {
        const source = this.sources.get(service);
        if (!source) throw new BadRequestException(`Возвраты ${service} пока не поддержаны`);
        return source;
    }

    /** Строка возврата по id; найденная живьём (в журнале её ещё нет) — по номеру отправления. */
    private async resolveLine(service: MpService, extId: string, posting?: string): Promise<ReturnLineDto> {
        const source = this.source(service);
        const byId = (await source.find({ kind: 'extId', value: extId }))[0];
        if (byId) return byId;
        const byPosting = posting
            ? (await source.find({ kind: 'posting', value: posting })).find((l) => l.extId === extId)
            : null;
        if (!byPosting) throw new NotFoundException(`Возврат ${extId} не найден`);
        return byPosting;
    }

    private async read<T>(fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        const t = await this.invoiceService.getTransaction();
        try {
            const result = await fn(t);
            await t.commit(true);
            return result;
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    /** Одна транзакция на кнопку: любой отказ или сбой — откат целиком, кладовщику — понятный текст. */
    private async write<T>(fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        const t = await this.invoiceService.getTransaction();
        try {
            const result = await fn(t);
            await t.commit(true);
            return result;
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            if (e instanceof ReturnRefusedError) throw new BadRequestException(e.message);
            const text = String(e?.message ?? e);
            if (LOCK_ERROR.test(text)) {
                throw new ConflictException('Запись занята автоматикой возвратов — повторите через минуту');
            }
            this.logger.error(`Приём возврата: ${text}`);
            throw e;
        }
    }

    private acceptMessage(ctx: AcceptContext): string {
        if (ctx.action === 'problem') return 'Отмечено проблемой';
        const base = `Принято ${ctx.card.quan} шт, счёт №${ctx.card.invoice?.number ?? '?'}`;
        return ctx.writeOff ? `${base}; списано, документ ${ctx.writeOff.spisCode}` : base;
    }

    /** После commit — замыкание, не шаг цепочки: при откате уведомлять не о чем. */
    private notifyAccepted(ctx: AcceptContext): void {
        const { line, card } = ctx;
        const goods = card.invoiceLine?.name ?? line.productName ?? line.offerId;
        const head = `${line.posting}: счёт №${card.invoice?.number ?? '?'}, ${goods} — ${card.quan} шт`;
        if (ctx.action === 'problem') {
            this.eventEmitter.emit(
                'error.message',
                'Проблема с возвратом',
                `${head}\nПричина покупателя: ${line.reason ?? '—'}\nКладовщик (${ctx.username}): ${ctx.comment}`,
                NotifyTopic.OPS,
            );
            return;
        }
        const parts = [`${head}, принял ${ctx.username}`];
        if (ctx.writeOff) parts.push(`Списан: документ ${ctx.writeOff.spisCode}`);
        if (ctx.retiredKis.length && !ctx.writeOff) {
            parts.push(`Вернуть в оборот в Честном знаке (${ctx.retiredKis.length}):\n${ctx.retiredKis.join('\n')}`);
        }
        this.eventEmitter.emit('error.message', 'Принят возврат', parts.join('\n'), NotifyTopic.OPS);
    }
}
