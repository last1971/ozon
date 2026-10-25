import { Injectable } from '@nestjs/common';
import { toNumber } from 'lodash';
import { ISupplierMarkup, SupplierMarkupResult } from './i.supplier.markup';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';
import { IPriceable } from '../../interfaces/i.priceable';
import { calculatePrice } from '../../helpers';

/**
 * Общая наценка — ровно та же дорога, что у наших товаров на сайте: проценты от закупки
 * (getInitialPercents 10/103/500 и подбор под MIN_PROFIT_RUB), расходы и налог сайта
 * (SyliusPriceService.getObtainCoeffs: TAX_UNIT, этикетка, упаковка, эквайринг), формула calculatePrice.
 * Площадочных комиссий и доставки покупателю нет — это сайт.
 */
@Injectable()
export class DefaultMarkup implements ISupplierMarkup {
    constructor(
        private readonly priceCalculationHelper: PriceCalculationHelper,
        private readonly syliusPriceService: SyliusPriceService,
    ) {}

    apply(code: string, costRub: number): SupplierMarkupResult {
        const priceable: IPriceable = {
            offer_id: code,
            incoming_price: costRub,
            available_price: 0,
            fbs_direct_flow_trans_max_amount: 0,
            sales_percent: 0,
            min_perc: 0,
            perc: 0,
            old_perc: 0,
            adv_perc: 0,
            sum_pack: this.priceCalculationHelper.getDefaultPercents().packing_price,
        };
        const percents = this.priceCalculationHelper.adjustPercents(priceable, this.syliusPriceService);
        const calculated = calculatePrice({ ...priceable, ...percents }, this.syliusPriceService.getObtainCoeffs());
        return {
            price: toNumber(calculated.price),
            old_price: toNumber(calculated.old_price),
            min_price: toNumber(calculated.min_price),
            ...percents,
        };
    }
}
