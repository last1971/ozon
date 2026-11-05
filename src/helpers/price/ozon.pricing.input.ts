import type { IPriceable } from '../../interfaces/i.priceable';
import type { ObtainCoeffsDto } from '../dto/obtain.coeffs.dto';
import type { OzonPricingInput } from './ozon.pricing';

/** Один переход от общего контракта площадок к входу чистого расчёта Ozon. */
export function ozonPricingInput(price: IPriceable, coeffs: ObtainCoeffsDto): OzonPricingInput {
    if (!price.ozon) throw new Error('Нет тарифных ступеней Ozon');
    return {
        ...price.ozon,
        base: Number(price.available_price) > 0 ? Number(price.available_price) : Number(price.incoming_price),
        baseSource: price.base_source,
        markups: { min: Number(price.min_perc), normal: Number(price.perc), max: Number(price.old_perc) },
        advertisingPercent: Number(price.adv_perc ?? 0),
        packing: Number(coeffs.sumPack ?? price.sum_pack ?? 0),
        label: Number(coeffs.sumLabel),
        handling: Number(coeffs.sumObtain),
        taxPercent: Number(coeffs.taxUnit),
        returnRate: price.return_perc ?? 0,
    };
}
