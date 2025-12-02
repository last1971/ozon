import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

@Injectable()
export class FilterByIncomingPriceBelowCommand implements ICommandAsync<IGoodsProcessingContext> {
    private readonly DEFAULT_MAX_PRICE = 150;

    private getEffectiveIncomingPrice(p: { available_price: number; incoming_price: number }): number {
        return p.available_price > 0 ? p.available_price : p.incoming_price;
    }

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        const maxPrice = context.filterMaxIncomingPrice ?? this.DEFAULT_MAX_PRICE;
        const before = prices.length;

        context.ozonPrices = prices.filter(p => {
            const effectivePrice = this.getEffectiveIncomingPrice(p);
            return effectivePrice > 0 && effectivePrice < maxPrice;
        });

        context.logger?.log(`Фильтр по входной цене < ${maxPrice}: ${before} -> ${context.ozonPrices.length}`);
        return context;
    }
}
