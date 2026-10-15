import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { AcceptContext } from './return.contexts';

/**
 * 5. Коды, выведенные нашей продажей (6/1), возвращаем в оборот у себя (6→5) — как автоматика по
 * ReceivedBySeller. Если вывод уже ушёл в ГИС МТ, код попадает в очередь «вернуть в оборот там».
 */
@Injectable()
export class UnretireMarksCommand implements ICommandAsync<AcceptContext> {
    constructor(@Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const retiredKis: string[] = [];
        for (const ki of ctx.kis) {
            const code = ctx.card.codes.find((c) => c.ki === ki);
            if (code.status !== 6 || code.retireReason !== 1) continue;
            await this.invoiceService.markCodeFbsUnsold(ki, ctx.t);
            if (code.chzSent) retiredKis.push(ki);
        }
        return { ...ctx, retiredKis };
    }
}
