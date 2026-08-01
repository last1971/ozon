import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IFboCreateContext } from './i.fbo-create.context';
import { FboMarkMigrationService } from '../fbo-mark-migration.service';
import { FboShortageDto } from '../dto/fbo-shortage.dto';
import { InvoiceDto } from '../../invoice/dto/invoice.dto';
import { goodCode, goodQuantityCoeff } from '../../helpers';

/**
 * Создаёт FBO-счёт (всегда) и разносит товар с подборки, собирая недостачи в контекст:
 * - migration — через migrate() (коды + подборка), недобор возвращается остатком;
 * - legacy — по позиции: есть донор → снимаем подборку и пишем цепочку, нет → позиция в недостачу.
 * Недостачу не списываем и заказ не отменяем — счёт остаётся, недобор уходит письмом (LogShortageNotify).
 * WB-исключение: заказ без подбора вообще («левый») — счёт не создаём (stopChain).
 */
@Injectable()
export class CreateFboInvoiceCommand implements ICommandAsync<IFboCreateContext> {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly migrationService: FboMarkMigrationService,
    ) {}

    async execute(context: IFboCreateContext): Promise<IFboCreateContext> {
        const { posting, prims, buyerId, transaction } = context;

        // WB: подбора нет вовсе → «левый» заказ, тихо пропускаем (не создаём).
        if (context.skipIfNoPodbor && !(await this.hasAnyPodbor(context))) {
            return { ...context, invoice: null, stopChain: true };
        }

        let invoice: InvoiceDto;
        let shortages: FboShortageDto[];

        if (context.useMigration) {
            invoice = await this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
            if (!invoice) throw new Error(`FBO: счёт для ${posting.posting_number} не создан`);
            shortages = await this.migrationService.migrate(
                posting.products,
                prims,
                invoice.invoiceLines,
                invoice.id,
                transaction,
                posting.posting_number,
            );
        } else {
            // legacy: подборку донора снимаем ДО создания счёта (освобождаем сток под авто-резерв).
            const donors: { index: number; gc: string; need: number; scode: number; realpricecode: number }[] = [];
            shortages = [];
            for (let i = 0; i < posting.products.length; i++) {
                const product = posting.products[i];
                const gc = goodCode(product);
                const need = product.quantity * goodQuantityCoeff(product);
                const donor = await this.invoiceService.findFboPodbposDonor(gc, prims, need, transaction);
                if (donor) {
                    await this.invoiceService.decrementPodbpos(donor.podbposcode, need, transaction);
                    donors.push({ index: i, gc, need, scode: donor.scode, realpricecode: donor.realpricecode });
                } else {
                    shortages.push({ goodscode: gc, quantity: need });
                }
            }
            invoice = await this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
            if (!invoice) throw new Error(`FBO: счёт для ${posting.posting_number} не создан`);
            for (const d of donors) {
                await this.invoiceService.logMigrationLink(
                    {
                        posting: posting.posting_number,
                        goodscode: d.gc,
                        quantity: d.need,
                        donorScode: d.scode,
                        donorRpc: d.realpricecode,
                        targetScode: invoice.id,
                        targetRpc: invoice.invoiceLines[d.index]?.realpricecode,
                    },
                    transaction,
                );
            }
        }

        if (context.setIgkNot1c) await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
        // Подбор (для WB) вынесен в PickupFboCommand — после записи журнала недобора.
        return { ...context, invoice, shortages };
    }

    /** Есть ли у заказа хоть какой-то подбор (read-only) — для WB-отсева «левых» заказов. */
    private async hasAnyPodbor(context: IFboCreateContext): Promise<boolean> {
        for (const product of context.posting.products) {
            const gc = goodCode(product);
            const nominal = goodQuantityCoeff(product);
            const need = product.quantity * nominal;
            if (context.useMigration) {
                const candidates = await this.invoiceService.findFboPodbposCandidates(
                    gc,
                    context.prims,
                    nominal,
                    context.transaction,
                );
                if (candidates.length > 0) return true;
            } else {
                const donor = await this.invoiceService.findFboPodbposDonor(gc, context.prims, need, context.transaction);
                if (donor) return true;
            }
        }
        return false;
    }
}
