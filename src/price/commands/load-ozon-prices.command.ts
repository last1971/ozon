import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';

@Injectable()
export class LoadOzonPricesCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(private readonly priceService: PriceService) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const skus = context.ozonSkus || [];
        context.logger?.log(`Загружаем цены для ${skus.length} товаров Ozon`);

        context.ozonPrices = await this.priceService.getOzonPrices(skus);

        context.logger?.log(`Загружено ${context.ozonPrices.length} цен`);
        return context;
    }
}
