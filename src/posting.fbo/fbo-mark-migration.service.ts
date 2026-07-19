import { Inject, Injectable, Logger } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { InvoiceLineDto } from '../invoice/dto/invoice.line.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { FboShortageDto } from './dto/fbo-shortage.dto';

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
    ) {}

    async migrate(
        products: ProductPostingDto[],
        prims: string[],
        invoiceLines: InvoiceLineDto[],
        scode: number,
        transaction: FirebirdTransaction,
    ): Promise<FboShortageDto[]> {
        const shortages: FboShortageDto[] = [];
        const s_s = this.invoiceService.getStorageSS();

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

            const candidates = await this.invoiceService.findFboPodbposCandidates(gc, prims, nominal, transaction);

            for (const cand of candidates) {
                if (need <= 0) break;
                let take = Math.min(cand.quanAvail, need);
                if (take <= 0) continue;

                // 1) Коды: целые, только номинала N, TT=3 вперёд.
                const migrated: string[] = [];
                const codes = await this.invoiceService.findLiveMigratableCodes(
                    cand.realpricecode,
                    nominal,
                    transaction,
                );
                const maxCodes = Math.floor(take / nominal);
                for (const code of codes.slice(0, maxCodes)) {
                    try {
                        await this.invoiceService.migrateMarkCode(
                            code.ki,
                            cand.realpricecode,
                            newRpc,
                            gc,
                            s_s,
                            transaction,
                        );
                        migrated.push(code.ki);
                    } catch (e) {
                        // Код застрял (гонка, параллельная ручная операция, кривые данные):
                        // его штуки остаются на А вместе с ним, иначе код повисает без товара
                        // и партийный учёт задваивается.
                        take -= nominal;
                        this.logger.warn(
                            `FBO migration: КМ ${code.ki} не переехал (RPC ${cand.realpricecode} -> ${newRpc}): ${e.message}`,
                        );
                    }
                }
                if (take <= 0) continue;

                // 2) Подборка: счёт А минус, счёт Б плюс, атомарной SP.
                try {
                    await this.invoiceService.migratePodbpos(
                        cand.podbposcode,
                        scode,
                        newRpc,
                        gc,
                        take,
                        transaction,
                    );
                } catch (e) {
                    // Перенос штук не прошёл (гонка/партийный учёт) — возвращаем уже
                    // переехавшие коды кандидата назад, кандидат пропускается.
                    this.logger.warn(
                        `FBO migration: перенос подборки не прошёл (PODBPOS ${cand.podbposcode}, take=${take}): ${e.message}`,
                    );
                    for (const ki of migrated) {
                        try {
                            await this.invoiceService.migrateMarkCode(
                                ki,
                                newRpc,
                                cand.realpricecode,
                                gc,
                                s_s,
                                transaction,
                            );
                        } catch (e2) {
                            this.eventEmitter.emit(
                                'error.message',
                                'FBO migration: КМ завис на счёте продажи без подборки — нужен ручной разбор',
                                `КМ ${ki}, GOODSCODE ${gc}, RPC ${newRpc} (SCODE ${scode}): ${e2.message}`,
                            );
                        }
                    }
                    continue;
                }
                need -= take;

                // Кодов уехало меньше, чем штук, при том что живые коды на кандидате были:
                // сигнал (кодов не хватает на товар), но НЕ недостача — штуки переехали.
                const coveredByCodes = migrated.length * nominal;
                if (coveredByCodes < take && cand.cntLive > 0) {
                    this.eventEmitter.emit(
                        'error.message',
                        'FBO migration: часть товара переехала без кодов маркировки',
                        `GOODSCODE ${gc}: перенесено ${take} шт, кодами покрыто ${coveredByCodes} (SCODE ${cand.scode} -> ${scode})`,
                    );
                }
            }

            if (need > 0) shortages.push({ goodscode: gc, quantity: need });
        }

        return shortages;
    }
}
