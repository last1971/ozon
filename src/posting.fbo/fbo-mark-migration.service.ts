import { Inject, Injectable, Logger } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { InvoiceLineDto } from '../invoice/dto/invoice.line.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { FboShortageDto } from './dto/fbo-shortage.dto';
import { DonorTransferError, DonorTransferService, TransferResult } from './donor-transfer.service';

// S12: при FBO-продаже из счёта А в счёт Б переезжают и коды маркировки, и подборка.
// Порядок по кандидату строго «сначала коды, потом подборка» (в одной транзакции):
// декремент подборки не освобождает FIFO, пока кодовые резервы живы на строке А.
// Через свободный остаток ничего не ходит — прямой перенос, партия кода не разъезжается.
@Injectable()
export class FboMarkMigrationService {
    private readonly logger = new Logger(FboMarkMigrationService.name);

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private eventEmitter: EventEmitter2,
        private transferService: DonorTransferService,
    ) {}

    async migrate(
        products: ProductPostingDto[],
        prims: string[],
        invoiceLines: InvoiceLineDto[],
        scode: number,
        transaction: FirebirdTransaction,
        posting: string,
    ): Promise<FboShortageDto[]> {
        const shortages: FboShortageDto[] = [];

        // Фантомный резерв счёта Б со свободного полочного остатка — снять до переноса,
        // иначе полочный товар спишется второй раз при pickupInvoice.
        await this.invoiceService.clearInvoiceReserve(scode, transaction);

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const gc = goodCode(product);
            const nominal = goodQuantityCoeff(product);
            let need = product.quantity * nominal;
            const newRpc = invoiceLines[i]?.realpricecode;
            if (!newRpc) {
                throw new Error(`FBO migration: нет realpricecode для строки ${i} (GOODSCODE=${gc}, SCODE=${scode})`);
            }

            // Донор с кодами чужого номинала в выборку не попадает (правило — в источнике,
            // общее с hasAnyPodbor); сюда доходит только письмо, потому что счёт уже создан.
            const candidates = await this.invoiceService.findFboPodbposCandidates(
                gc,
                prims,
                nominal,
                transaction,
                (cand) =>
                    this.eventEmitter.emit(
                        'error.message',
                        'FBO migration: донор с кодом другого номинала пропущен',
                        `GOODSCODE ${gc}: на строке донора (SCODE ${cand.scode}, RPC ${cand.realpricecode}) ` +
                            `${cand.quanAvail} шт и живых кодов ${cand.cntLive}, но ни одного номинала ${nominal}. ` +
                            `Поделить код в ЧЗ или подобрать из другой партии.`,
                    ),
            );

            for (const cand of candidates) {
                if (need <= 0) break;
                let take = Math.min(cand.quanAvail, need);
                if (take <= 0) continue;

                // Количественный код (1 КИ = N шт) переехать не может: findLiveMigratableCodes
                // берёт строго номинал nominal, а дробить КМ без новой этикетки ЧЗ нельзя.
                // Если на строке живые коды есть, но все крупного номинала — штуки отсюда
                // не отщипываем: код осиротел бы на доноре, а товар уехал бы на маркетплейс
                // без маркировки (так из одной строки на 20 шт утекло 11 штук по одной).
                if (cand.cntLive > 0 && cand.cntNom === 0) {
                    this.eventEmitter.emit(
                        'error.message',
                        'FBO migration: донор с кодом другого номинала пропущен',
                        `GOODSCODE ${gc}: на строке донора (SCODE ${cand.scode}, RPC ${cand.realpricecode}) ` +
                            `живых кодов ${cand.cntLive}, из них номинала ${nominal} — ни одного. ` +
                            `Нужно ${take} шт: либо поделить код в ЧЗ, либо подобрать из другой партии.`,
                    );
                    continue;
                }

                // Перенос — одна точка на автоматику и ручной разбор (DonorTransferService).
                // Подборка не переехала — кандидат пропущен, коды уже возвращены; остальное наружу.
                let result: TransferResult;
                try {
                    result = await this.transferService.transfer(
                        cand,
                        take,
                        { scode, realpricecode: newRpc, goodscode: gc, nominal, posting },
                        transaction,
                    );
                } catch (e) {
                    if (e instanceof DonorTransferError) continue;
                    throw e;
                }
                if (result.moved <= 0) continue;
                take = result.moved;
                need -= take;
                const migrated = result.codes;

                // Кодов уехало меньше, чем штук, при том что живые коды на кандидате были:
                // сигнал (кодов не хватает на товар), но НЕ недостача — штуки переехали.
                const coveredByCodes = migrated.length * nominal;
                if (coveredByCodes < take && cand.cntLive > 0) {
                    this.eventEmitter.emit(
                        'error.message',
                        'FBO migration: часть товара переехала без кодов маркировки',
                        `GOODSCODE ${gc}: перенесено ${take} шт, кодами покрыто ${coveredByCodes} (SCODE ${cand.scode} -> ${scode})`,
                    );
                } else if (coveredByCodes < take && cand.cntDead > 0) {
                    // Живых кодов нет, но на строке донора лежит выведенный (TT=3, STATUS=6):
                    // это возврат проданного, который разобрали без оживления кода. Гейт
                    // cntLive такой случай глушил — товар уезжал в полной тишине.
                    this.eventEmitter.emit(
                        'error.message',
                        'FBO migration: на доноре выведенный код — возврат проданного без оживления',
                        `GOODSCODE ${gc}: перенесено ${take} шт без кодов, на строке донора ` +
                            `выведенных кодов: ${cand.cntDead} (SCODE ${cand.scode} -> ${scode}) — ` +
                            `нужен ручной unretire (MARKCODE_FBS_UNSOLD) и разбор в ЧЗ`,
                    );
                }
            }

            if (need > 0) shortages.push({ goodscode: gc, quantity: need });
        }

        return shortages;
    }
}
