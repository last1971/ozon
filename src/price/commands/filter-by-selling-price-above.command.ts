import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

@Injectable()
export class FilterBySellingPriceAboveCommand implements ICommandAsync<IGoodsProcessingContext> {
    private readonly DEFAULT_PRICE_THRESHOLD = 300;

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        const threshold = context.priceThreshold ?? this.DEFAULT_PRICE_THRESHOLD;
        const before = prices.length;

        context.ozonPrices = prices.filter(p => p.marketing_seller_price > threshold);

        context.logger?.log(`Фильтр по цене > ${threshold}: ${before} -> ${context.ozonPrices.length}`);
        return context;
    }
}
