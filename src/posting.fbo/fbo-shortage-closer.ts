import { Inject, Injectable } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';

/**
 * Единственная точка «недобор закрыт руками»: списать закрытое из журнала FBO_SHORTAGE по товарам
 * и, если по счёту недобора не осталось, отдать счёт в подбор — как делает автоматика после переезда.
 * Зовут и перенос с доноров, и пересортица; порядок и правило одни.
 */
@Injectable()
export class FboShortageCloser {
    constructor(@Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice) {}

    async close(
        posting: string,
        scode: number,
        perGood: Map<string, number>,
        t: FirebirdTransaction,
    ): Promise<{ shortageClosed: boolean; pickedUp: boolean }> {
        for (const [goodscode, quantity] of perGood) {
            await this.invoiceService.closeFboShortage(posting, goodscode, quantity, t);
        }
        const shortageClosed = !(await this.invoiceService.isInFboShortage(posting, t));
        if (!shortageClosed) return { shortageClosed, pickedUp: false };

        const invoice = (await this.invoiceService.getPrimContaining(posting, t)).find((i) => i.id === scode);
        if (!invoice) return { shortageClosed, pickedUp: false };
        await this.invoiceService.pickupFboUnlessShortage(invoice, t);
        return { shortageClosed, pickedUp: true };
    }
}
