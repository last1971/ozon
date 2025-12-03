import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { calculatePrice } from '../../helpers';
import { toNumber } from 'lodash';

@Injectable()
export class CalculatePercentsWithLowCommissionCommand implements ICommandAsync<IGoodsProcessingContext> {
    // Тарифы логистики FBS для товаров до 300₽ по объёму (с НДС)
    private readonly FBS_LOGISTICS_TARIFFS = [
        { maxVolume: 0.2, price: 17.28 },
        { maxVolume: 0.4, price: 19.32 },
        { maxVolume: 0.6, price: 21.35 },
        { maxVolume: 0.8, price: 22.37 },
        { maxVolume: 1.0, price: 23.38 },
        { maxVolume: 1.25, price: 25.42 },
        { maxVolume: 1.5, price: 26.43 },
        { maxVolume: 1.75, price: 27.45 },
        { maxVolume: 2.0, price: 29.48 },
        { maxVolume: 3.0, price: 31.52 },
        { maxVolume: 4.0, price: 35.58 },
        { maxVolume: 5.0, price: 38.63 },
        { maxVolume: 6.0, price: 42.7 },
        { maxVolume: 7.0, price: 57.95 },
        { maxVolume: 8.0, price: 62.02 },
        { maxVolume: 9.0, price: 65.07 },
        { maxVolume: 10.0, price: 69.13 },
        { maxVolume: 11.0, price: 79.3 },
        { maxVolume: 12.0, price: 83.37 },
        { maxVolume: 13.0, price: 87.43 },
        { maxVolume: 14.0, price: 92.52 },
        { maxVolume: 15.0, price: 96.58 },
        { maxVolume: 17.0, price: 101.67 },
        { maxVolume: 20.0, price: 110.82 },
        { maxVolume: 25.0, price: 118.95 },
        { maxVolume: 30.0, price: 131.15 },
        { maxVolume: 35.0, price: 146.4 },
        { maxVolume: 40.0, price: 156.57 },
        { maxVolume: 45.0, price: 175.88 },
        { maxVolume: 50.0, price: 189.1 },
        { maxVolume: 60.0, price: 207.4 },
        { maxVolume: 70.0, price: 230.78 },
        { maxVolume: 80.0, price: 249.08 },
        { maxVolume: 90.0, price: 274.5 },
        { maxVolume: 100.0, price: 284.67 },
        { maxVolume: 125.0, price: 331.43 },
        { maxVolume: 150.0, price: 381.25 },
        { maxVolume: 175.0, price: 436.15 },
        { maxVolume: 190.0, price: 483.93 },
        { maxVolume: Infinity, price: 805.2 },
    ];

    constructor(
        private readonly priceService: PriceService,
        private readonly priceCalculationHelper: PriceCalculationHelper,
    ) {}

    private getFbsLogistics(volumeWeight?: number): number {
        if (!volumeWeight) return this.FBS_LOGISTICS_TARIFFS[0].price;
        const tariff = this.FBS_LOGISTICS_TARIFFS.find(t => volumeWeight <= t.maxVolume);
        return tariff?.price ?? this.FBS_LOGISTICS_TARIFFS[this.FBS_LOGISTICS_TARIFFS.length - 1].price;
    }

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const prices = context.ozonPrices || [];
        context.logger?.log(`Расчёт процентов с низкой комиссией для ${prices.length} товаров`);

        let processed = 0;
        for (const price of prices) {
            if (!price.typeId) continue;

            const commission = await this.priceService.getCommission(String(price.typeId));
            if (!commission) continue;

            // FBO или FBS в зависимости от остатков
            const newSalesPercent = (price.fboCount > price.fbsCount ? commission.fbo : commission.fbs) * 100;

            const incomingPrice = price.available_price > 0 ? price.available_price : price.incoming_price;
            const initialPrice = {
                adv_perc: price.adv_perc,
                fbs_direct_flow_trans_max_amount: this.getFbsLogistics(price.volumeWeight),
                incoming_price: incomingPrice,
                available_price: price.available_price,
                offer_id: price.offer_id,
                sales_percent: newSalesPercent,
                sum_pack: price.sum_pack,
                min_perc: 0,
                perc: 0,
                old_perc: 0,
            };

            // Рассчитываем новые проценты
            const { min_perc, perc, old_perc } = this.priceCalculationHelper.adjustPercents(
                initialPrice,
                this.priceService,
            );

            // Рассчитываем цены
            const calculatedPrice = calculatePrice(
                { ...initialPrice, min_perc, perc, old_perc },
                this.priceService.getObtainCoeffs(),
            );

            // Обновляем в контексте
            price.min_perc = min_perc;
            price.perc = perc;
            price.old_perc = old_perc;
            price.sales_percent = newSalesPercent;
            price.min_price = toNumber(calculatedPrice.min_price);
            price.price = toNumber(calculatedPrice.price);
            price.old_price = toNumber(calculatedPrice.old_price);

            processed++;
        }

        context.logger?.log(`Пересчитано ${processed} товаров`);
        return context;
    }
}
