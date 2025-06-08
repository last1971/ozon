import { IPriceable } from '../../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../dto/obtain.coeffs.dto';
import { toNumber } from 'lodash';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';
/**
 * Вычисляет фиксированные и динамические издержки
 */
export const calculateCosts = (
    price: IPriceable,
    percents: ObtainCoeffsDto
): { fixedCosts: number; dynamicCosts: number } => {
    const fixedCosts: number =
        toNumber(percents.sumObtain) +
        toNumber(percents.sumLabel) +
        toNumber(price.sum_pack) +
        toNumber(price.fbs_direct_flow_trans_max_amount);

    const dynamicCosts: number =
        toNumber(price.sales_percent) +
        toNumber(percents.taxUnit) +
        toNumber(price.adv_perc) +
        toNumber(percents.percEkv);

    return { fixedCosts, dynamicCosts };
};

/**
 * Вычисляет сумму к оплате с учетом издержек
 */
export const calculatePay = (
    price: IPriceable,
    percents: ObtainCoeffsDto,
    sum: number
): number => {
    const { fixedCosts, dynamicCosts } = calculateCosts(price, percents);
    const mil = sum * (percents.percMil / 100);
    return (
        sum -
        fixedCosts -
        (mil < percents.minMil ? toNumber(percents.minMil) : 0) -
        (sum * (dynamicCosts + (mil < percents.minMil ? 0 : toNumber(percents.percMil)))) / 100
    );
};

/**
 * Вычисляет итоговую цену и связанные значения
 */
export const calculatePrice = (
    price: IPriceable,
    percents: ObtainCoeffsDto,
    auto_action = AutoAction.ENABLED,
    price_strategy_enabled = AutoAction.DISABLED,
): UpdatePriceDto => {
    const calc = (percent: number, price: IPriceable): string => {
        const { fixedCosts, dynamicCosts } = calculateCosts(price, percents);
        const incoming_price = toNumber(price.available_price) > 0 ? price.available_price : price.incoming_price;
        let calcPrice = Math.ceil(
            (toNumber(incoming_price) * (1 + toNumber(percent) / 100) + fixedCosts)
            /
            (1 - (dynamicCosts + toNumber(percents.percMil)) / 100)
        );
        const mil = calcPrice * (percents.percMil / 100);
        if (mil < percents.minMil) {
            calcPrice = Math.ceil(
                (toNumber(incoming_price) * (1 + toNumber(percent) / 100) + toNumber(percents.minMil) + fixedCosts)
                /
                (1 - dynamicCosts / 100)
            );
        }
        return calcPrice.toString();
    };
    return {
        auto_action_enabled: auto_action,
        price_strategy_enabled,
        currency_code: 'RUB',
        min_price: calc(price.min_perc, price),
        offer_id: price.offer_id,
        old_price: calc(price.old_perc, price),
        price: calc(price.perc, price),
        incoming_price: price.incoming_price,
        sum_pack: price.sum_pack,
    };
}; 