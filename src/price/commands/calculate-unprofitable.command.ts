import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext, IUnprofitableItem } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { calculatePay } from '../../helpers';
import { toNumber } from 'lodash';

@Injectable()
export class CalculateUnprofitableCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(private readonly priceService: PriceService) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        const percents = this.priceService.getObtainCoeffs();
        const unprofitable: IUnprofitableItem[] = [];

        for (const price of prices) {
            const incomingPrice = price.available_price > 0 ? price.available_price : price.incoming_price;
            if (incomingPrice <= 0) continue;

            const sellingPrice = toNumber(price.marketing_seller_price);
            const payResult = calculatePay(price, percents, sellingPrice);
            const profit = payResult.netProfit !== undefined ? payResult.netProfit : payResult.pay - incomingPrice;

            if (profit < 0) {
                unprofitable.push({
                    offer_id: price.offer_id,
                    name: price.name,
                    incoming_price: incomingPrice,
                    selling_price: sellingPrice,
                    loss: Math.abs(profit),
                });
            }
        }

        context.unprofitableItems = unprofitable;
        context.logger?.log(`Найдено ${unprofitable.length} убыточных товаров из ${prices.length}`);

        return context;
    }
}
