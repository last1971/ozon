import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { calculatePrice } from '../../helpers';
import { toNumber } from 'lodash';

/** Прежняя точка входа подбора наценок. Тарифы и формула общие с основным расчётом. */
@Injectable()
export class CalculatePercentsWithLowCommissionCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(
        private readonly priceService: PriceService,
        private readonly priceCalculationHelper: PriceCalculationHelper,
    ) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        let processed = 0;
        for (const price of prices) {
            if (price.base_source === 'none' || !(price.available_price > 0 || price.incoming_price > 0)) continue;
            const initialPrice = await this.priceService.withOzonPricing(price);
            const markups = this.priceCalculationHelper.adjustPercents(initialPrice, this.priceService);
            const calculated = calculatePrice({ ...initialPrice, ...markups }, this.priceService.getObtainCoeffs());
            Object.assign(price, markups, {
                ozon: initialPrice.ozon,
                return_flow_amount: initialPrice.return_flow_amount,
                min_price: toNumber(calculated.min_price),
                price: toNumber(calculated.price),
                old_price: toNumber(calculated.old_price),
            });
            processed++;
        }
        context.logger?.log(`Пересчитано по тарифным ступеням ${processed} товаров`);
        return context;
    }
}
