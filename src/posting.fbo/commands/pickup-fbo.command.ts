import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IFboCreateContext } from './i.fbo-create.context';

/**
 * Подбор счёта сразу после создания (WB). Идёт ПОСЛЕ LogShortageNotify — к этому моменту недобор
 * уже в FBO_SHORTAGE, поэтому pickupFboUnlessShortage корректно пропустит счёт с недобором.
 */
@Injectable()
export class PickupFboCommand implements ICommandAsync<IFboCreateContext> {
    constructor(@Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice) {}

    async execute(context: IFboCreateContext): Promise<IFboCreateContext> {
        if (context.pickupAfterCreate && context.invoice) {
            await this.invoiceService.pickupFboUnlessShortage(context.invoice, context.transaction);
        }
        return context;
    }
}
