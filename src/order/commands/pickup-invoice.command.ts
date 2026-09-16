import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IPickupContext } from './i.pickup.context';
import { INVOICE_SERVICE, IInvoice } from '../../interfaces/IInvoice';

/** Закрывает подбор счёта (QUAN* = QUAN*NEED). Наличие и коды не проверяет — это делают до него. */
@Injectable()
export class PickupInvoiceCommand implements ICommandAsync<IPickupContext> {
    constructor(@Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice) {}

    async execute(context: IPickupContext): Promise<IPickupContext> {
        await this.invoiceService.pickupInvoice(context.invoice, context.transaction);
        return context;
    }
}
