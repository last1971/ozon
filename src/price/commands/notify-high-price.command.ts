import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class NotifyHighPriceCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const highPrices = context.ozonPricesHighPrice || [];

        if (highPrices.length === 0) {
            context.logger?.log('Нет товаров для уведомления о высокой цене');
            return context;
        }

        context.logger?.log(`Уведомление о ${highPrices.length} товарах с price > порога`);

        this.eventEmitter.emit('ozon.high.price', highPrices);

        return context;
    }
}
