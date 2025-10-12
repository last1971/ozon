import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { WbOrderService } from '../wb.order.service';

@Injectable()
export class FetchOrdersByStickerCommand implements ICommandAsync<IWbTransactionProcessingContext> {
  constructor(
    @Inject(forwardRef(() => WbOrderService))
    private readonly wbOrderService: WbOrderService,
  ) {}

  async execute(context: IWbTransactionProcessingContext): Promise<IWbTransactionProcessingContext> {
    // Если srid уже найден в sales, пропускаем эту команду
    if (context.srid) {
      return { ...context };
    }

    // Получаем заказы начиная с dateFrom
    const dateFromStr = context.dateFrom.toISOString().split('T')[0];
    const orders = await this.wbOrderService.getOrders(dateFromStr, 0);

    if (!orders || orders.length === 0) {
      return { ...context };
    }

    // Ищем заказ по sticker
    const order = orders.find((o: any) => o.sticker === context.stickerId || o.sticker === parseInt(context.stickerId, 10));

    if (!order) {
      return { ...context };
    }

    // Нашли! Получаем srid из заказа
    return { ...context, srid: order.srid };
  }
}
