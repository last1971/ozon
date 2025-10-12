import { Injectable, Inject } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';

@Injectable()
export class FetchInvoiceByRemarkCommand implements ICommandAsync<IWbTransactionProcessingContext> {
  constructor(
    @Inject(INVOICE_SERVICE)
    private readonly invoiceService: IInvoice,
  ) {}

  async execute(context: IWbTransactionProcessingContext): Promise<IWbTransactionProcessingContext> {
    if (!context.selectedId) {
      return { ...context, stopChain: true };
    }

    // Используем getByPosting с containing = true для поиска по вхождению в примечание
    const invoice = await this.invoiceService.getByPosting(
      context.selectedId,
      null,
      true, // containing - поиск по вхождению строки в PRIM
    );

    return { ...context, invoice };
  }
}
