import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';

@Injectable()
export class UpdateOzonPricesCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(private readonly priceService: PriceService) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        context.logger?.log(`Обновляем ${prices.length} цен в Ozon`);

        if (prices.length === 0) {
            context.logger?.log('Нет цен для обновления');
            return context;
        }

        const updatePrices = prices.map(p => ({
            offer_id: p.offer_id,
            min_price: String(p.min_price),
            price: String(p.price),
            old_price: String(p.old_price),
            currency_code: 'RUB' as const,
        }));

        await this.priceService.updatePrices(updatePrices);

        context.logger?.log(`Обновлено ${prices.length} цен`);
        return context;
    }
}
