import { ConfigService } from '@nestjs/config';
import { toNumber } from 'lodash';
import { ISupplierMarkup, SupplierMarkupResult } from './i.supplier.markup';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';
import { IPriceable } from '../../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../../helpers/dto/obtain.coeffs.dto';
import { calculatePay, calculatePrice } from '../../helpers';

/**
 * Постоянные проценты от закупки (Компэл, владелец 27.10.2026; ruelectronics — «как у Компэла», 28.10.2026):
 * зачёркнутая <PREFIX>_OLD_PERC 15, обычная <PREFIX>_MARKUP_PERC 8, минимальная <PREFIX>_MIN_PERC 4; формула и
 * расходы сайта те же (calculatePrice, SyliusPriceService.getObtainCoeffs). Страховка: каждая из трёх цен не ниже
 * той, на которой прибыль <PREFIX>_MIN_PROFIT_RUB 10 ₽. Подбора процентов и разрывов «+20 / +40 ₽» общей наценки
 * здесь нет. У каждого поставщика свой префикс настроек — цифры одного не меняют другого.
 */
export class FixedPercentMarkup implements ISupplierMarkup {
    private readonly percents: { min_perc: number; perc: number; old_perc: number };
    private readonly minProfitRub: number;

    constructor(
        private readonly priceCalculationHelper: PriceCalculationHelper,
        private readonly syliusPriceService: SyliusPriceService,
        configService: ConfigService,
        prefix: string,
        label: string,
        defaults: { min_perc: number; perc: number; old_perc: number; minProfitRub: number } = {
            min_perc: 4,
            perc: 8,
            old_perc: 15,
            minProfitRub: 10,
        },
    ) {
        this.percents = {
            min_perc: toNumber(configService.get(`${prefix}_MIN_PERC`, defaults.min_perc)),
            perc: toNumber(configService.get(`${prefix}_MARKUP_PERC`, defaults.perc)),
            old_perc: toNumber(configService.get(`${prefix}_OLD_PERC`, defaults.old_perc)),
        };
        this.minProfitRub = toNumber(configService.get(`${prefix}_MIN_PROFIT_RUB`, defaults.minProfitRub));
        const { min_perc, perc, old_perc } = this.percents;
        if (![min_perc, perc, old_perc, this.minProfitRub].every((v) => Number.isFinite(v) && v >= 0)) {
            throw new Error(`Наценка ${label}: ${prefix}_*_PERC и ${prefix}_MIN_PROFIT_RUB должны быть числами ≥ 0`);
        }
        if (!(min_perc <= perc && perc <= old_perc)) {
            throw new Error(
                `Наценка ${label}: нужно минимальная ≤ обычная ≤ зачёркнутая (${min_perc}/${perc}/${old_perc})`,
            );
        }
    }

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
        const coeffs = this.syliusPriceService.getObtainCoeffs();
        const calculated = calculatePrice({ ...priceable, ...this.percents }, coeffs);
        return {
            price: this.withMinProfit(priceable, coeffs, toNumber(calculated.price)),
            old_price: this.withMinProfit(priceable, coeffs, toNumber(calculated.old_price)),
            min_price: this.withMinProfit(priceable, coeffs, toNumber(calculated.min_price)),
            ...this.percents,
        };
    }

    /** Наименьшая целая цена не ниже `price`, на которой прибыль не меньше страховки (прибыль — как у наших, calculatePay). */
    private withMinProfit(priceable: IPriceable, coeffs: ObtainCoeffsDto, price: number): number {
        const enough = (sum: number): boolean => {
            const pay = calculatePay(priceable, coeffs, sum);
            const profit = pay.netProfit !== undefined ? pay.netProfit : pay.pay - priceable.incoming_price;
            return profit >= this.minProfitRub;
        };
        if (enough(price)) return price;
        let low = price;
        let high = Math.max(price, 1) * 2;
        while (!enough(high)) {
            low = high;
            high *= 2;
        }
        while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (enough(mid)) high = mid;
            else low = mid;
        }
        return high;
    }
}
