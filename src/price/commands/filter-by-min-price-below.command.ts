import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

@Injectable()
export class FilterByMinPriceBelowCommand implements ICommandAsync<IGoodsProcessingContext> {
    private readonly DEFAULT_PRICE_THRESHOLD = 300;

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        const threshold = context.priceThreshold ?? this.DEFAULT_PRICE_THRESHOLD;
        const before = prices.length;

        // Оставляем где min_price <= 300
        context.ozonPrices = prices.filter(p => p.min_price <= threshold);

        // Из оставшихся — уведомить где price > 300
        context.ozonPricesHighPrice = context.ozonPrices.filter(p => p.price > threshold);

        context.logger?.log(`Фильтр по min_price <= ${threshold}: ${before} -> ${context.ozonPrices.length}, для уведомления: ${context.ozonPricesHighPrice.length}`);
        return context;
    }
}
