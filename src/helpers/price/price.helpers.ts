import { IPriceable } from '../../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../dto/obtain.coeffs.dto';
import { toNumber } from 'lodash';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';

const VAT_RATE = Number(process.env.VAT_RATE || 20);
const PROFIT_TAX_RATE = Number(process.env.PROFIT_TAX_RATE || 20);

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
    let ret = (
        sum -
        fixedCosts -
        (mil === 0 ? 0 : (mil < percents.minMil ? toNumber(percents.minMil) : 0)) -
        (sum * (dynamicCosts + (mil < percents.minMil ? 0 : toNumber(percents.percMil)))) / 100
    );
    if (percents.taxUnit === 0) {
        const { profitTax, vatToPay } = calculateOSNODetails(sum, price, percents);
        ret = ret - profitTax - vatToPay;
    }
    return ret;
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
        if (percents.taxUnit === 0) {
            const calcPrice = findSellingPriceOSNO(percent, price, percents);
            return Math.ceil(calcPrice).toString();
        }
        
        const { fixedCosts, dynamicCosts } = calculateCosts(price, percents);
        const incoming_price = toNumber(price.available_price) > 0 ? price.available_price : price.incoming_price;
        let calcPrice = Math.ceil(
            (toNumber(incoming_price) * (1 + toNumber(percent) / 100) + fixedCosts)
            /
            (1 - (dynamicCosts + toNumber(percents.percMil)) / 100)
        );
        const mil = calcPrice * (percents.percMil / 100);
        if (mil > 0 && mil < percents.minMil) {
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

/**
 * Вычисляет чистую прибыль для ОСНО (по алгоритму из test-price.ts)
 */
export const calcNetProfitOSNO = (
    priceWithVAT: number,
    price: IPriceable,
    percents: ObtainCoeffsDto
): number => {
    const { profitBeforeTax, profitTax, vatToPay } = calculateOSNODetails(priceWithVAT, price, percents);
    return profitBeforeTax - profitTax - vatToPay;
};

/**
 * Находит цену продажи для ОСНО (бинарный поиск)
 */
export const findSellingPriceOSNO = (
    percent: number,
    price: IPriceable,
    percents: ObtainCoeffsDto
): number => {
    const incoming_price = toNumber(price.available_price) > 0 ? price.available_price : price.incoming_price;
    const targetProfit = incoming_price * (percent / 100);
    
    let low = 0;
    // Цена не может быть выше 100000 рублей
    let high = 100000;
    // Точность 1 рубль
    let tolerance = 1;

    while (high - low > tolerance) {
        const mid = (low + high) / 2;
        const profit = calcNetProfitOSNO(mid, price, percents);

        if (profit < targetProfit) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return (low + high) / 2;
};

/**
 * Вычисляет все детали для ОСНО
 */
export const calculateOSNODetails = (
    priceWithVAT: number,
    price: IPriceable,
    percents: ObtainCoeffsDto
): { profitBeforeTax: number; profitTax: number; vatToPay: number; } => {
    const { fixedCosts, dynamicCosts } = calculateCosts(price, percents);

    const priceNoVAT = priceWithVAT / (1 + VAT_RATE / 100); // выручка без НДС
    const fixedNoVAT = fixedCosts / (1 + VAT_RATE / 100);
    const dynamicCost = priceWithVAT * (dynamicCosts / 100); // динамика с НДС
    const dynamicNoVAT = dynamicCost / (1 + VAT_RATE / 100);
    const incoming_price = toNumber(price.available_price) > 0 ? price.available_price : price.incoming_price;
    const costNoVAT = incoming_price / (1 + VAT_RATE / 100); // себестоимость без НДС

    // Расчет прибыли до налога на прибыль
    const totalCostsNoVAT = fixedNoVAT + dynamicNoVAT + costNoVAT;
    const profitBeforeTax = priceNoVAT - totalCostsNoVAT;
    
    // Расчет налога на прибыль
    const profitTax = profitBeforeTax * (PROFIT_TAX_RATE / 100);

    // Расчет НДС
    const fixedVAT = fixedCosts - fixedNoVAT;
    const dynamicVAT = dynamicCost - dynamicNoVAT;
    const inputVAT = (incoming_price - costNoVAT) + fixedVAT + dynamicVAT;
    const outputVAT = priceWithVAT - priceNoVAT;
    const vatToPay = Math.max(outputVAT - inputVAT, 0);

    return { profitBeforeTax, profitTax, vatToPay };
}; 