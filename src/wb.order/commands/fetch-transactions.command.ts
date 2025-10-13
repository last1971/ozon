import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { WbOrderService } from '../wb.order.service';

@Injectable()
export class FetchTransactionsCommand implements ICommandAsync<IWbTransactionProcessingContext> {
  constructor(
    @Inject(forwardRef(() => WbOrderService))
    private readonly wbOrderService: WbOrderService,
  ) {}

  async execute(context: IWbTransactionProcessingContext): Promise<IWbTransactionProcessingContext> {

    const dateTo = context.dateTo || new Date();
    const allTransactions = await this.wbOrderService.getTransactions({
      from: context.dateFrom,
      to: dateTo,
    });

    let transactions = [];
    if(context.srid) {
    // Фильтруем транзакции по srid
      transactions = allTransactions.filter((t) => t.srid === context.srid);
    } else {
      transactions = allTransactions.filter((t: any) => t.sticker_id === context.stickerId || t.sticker_id === parseInt(context.stickerId, 10));
    }

    return { ...context, transactions, dateTo };
  }
}
