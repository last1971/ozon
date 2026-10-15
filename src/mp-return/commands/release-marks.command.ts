import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { AcceptContext } from './return.contexts';

/**
 * 6. Отсканированные коды — на склад: снять привязку к строке (резерв партии по QUANTITY), затем TT→0.
 * Порядок проверен на dev 15.10: наоборот резерв партии снимается дважды.
 */
@Injectable()
export class ReleaseMarksCommand implements ICommandAsync<AcceptContext> {
    constructor(
        @Inject(RETURN_STOCK) private readonly stock: IReturnStock,
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
    ) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const rpc = ctx.card.invoiceLine.realpricecode;
        for (const ki of ctx.kis) {
            const code = ctx.card.codes.find((c) => c.ki === ki);
            await this.stock.detachFromRealprice(ki, rpc, ctx.t);
            if (code.transferType === 3)
                await this.invoiceService.markCodeReturnToStock(ki, this.stock.storageSS(), ctx.t);
        }
        return ctx;
    }
}
