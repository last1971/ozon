import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { WbOrderService } from '../wb.order.service';

@Injectable()
export class FetchSalesByStickerCommand implements ICommandAsync<IWbTransactionProcessingContext> {
  constructor(
    @Inject(forwardRef(() => WbOrderService))
    private readonly wbOrderService: WbOrderService,
  ) {}

  async execute(context: IWbTransactionProcessingContext): Promise<IWbTransactionProcessingContext> {
    // Получаем продажи начиная с dateFrom
    const dateFromStr = context.dateFrom.toISOString().split('T')[0];
    const sales = await this.wbOrderService.getSales(dateFromStr);

    const hz = sales.filter((s) => s.sticker !== '');

    if (!sales || sales.length === 0) {
      // Продолжаем цепочку - попробуем найти в orders
      return { ...context };
    }

    // Ищем продажу по sticker
    const sale = sales.find((s: any) => s.sticker === context.stickerId || s.sticker === parseInt(context.stickerId, 10));

    if (!sale) {
      // Не нашли в sales - продолжаем цепочку, попробуем в orders
      return { ...context };
    }

    // Нашли! Получаем srid из продажи
    return { ...context, srid: sale.srid };
  }
}
