import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { AcceptContext } from './return.contexts';

/** Статусы, из которых частичный возврат пересобирает счёт (сформирован / в подборке / собран). */
const RESTATABLE = [1, 3, 4];

/**
 * 8. Статус счёта после расформирования (решения владельца 15.10):
 *  - подобранного не осталось → 0;
 *  - осталось (частичный возврат) → 0, количество строк := подобрано (при 0 запрет LockEdS не действует),
 *    затем 1, если счёт донор (или был сформирован), иначе 4 — чтобы недельное закрытие начислений его закрыло.
 * Счёт уже в 0 (отменён до нас) не трогаем: собирать его заново нельзя.
 */
@Injectable()
export class RestateInvoiceCommand implements ICommandAsync<AcceptContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const { invoice } = ctx.card;
        if (!(await this.stock.hasPicked(invoice.scode, ctx.t))) {
            if (invoice.status !== 0) await this.stock.setInvoiceStatus(invoice.scode, 0, ctx.t);
            return ctx;
        }
        if (!RESTATABLE.includes(invoice.status)) return ctx;
        await this.stock.setInvoiceStatus(invoice.scode, 0, ctx.t);
        await this.stock.setLineQuantitiesToPicked(invoice.scode, ctx.t);
        await this.stock.setInvoiceStatus(invoice.scode, invoice.isDonor || invoice.status === 1 ? 1 : 4, ctx.t);
        return ctx;
    }
}
