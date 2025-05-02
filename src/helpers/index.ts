import { IOfferIdable } from '../interfaces/IOfferIdable';
import { IPriceable } from '../interfaces/i.priceable';
import { ObtainCoeffsDto } from './obtain.coeffs.dto';
import { AutoAction, UpdatePriceDto } from '../price/dto/update.price.dto';
import { toNumber, head } from 'lodash';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import TextOptions = PDFKit.Mixins.TextOptions;

export const goodCode = (value: IOfferIdable): string => value.offer_id.toString().replace(/-.*/g, '');
export const goodQuantityCoeff = (value: IOfferIdable): any => {
    const offerIdStr = value.offer_id.toString();
    const dashIndex = offerIdStr.indexOf('-');
    if (dashIndex === -1) {
        return 1;
    }
    const coeff = offerIdStr.slice(dashIndex + 1);
    const parsed = parseInt(coeff, 10);
    return isNaN(parsed) ? 1 : parsed;
};
export const productQuantity = (goodQuantity: number, goodCoeff: number) =>
    goodQuantity ? Math.floor(goodQuantity / goodCoeff) : 0;

export class StringToIOfferIdableAdapter implements IOfferIdable {
    offer_id: string;
    constructor(offer_id: string) {
        this.offer_id = offer_id;
    }
}

/**
 * Calculates fixed and dynamic costs based on provided price and percentage coefficients.
 *
 * @param {IPriceable} price - The object containing various price-related properties such as packaging and flow amounts.
 * @param {ObtainCoeffsDto} percents - The object containing percentage coefficients and other related values.
 * @returns {Object} An object containing the calculated fixed and dynamic costs:
 * - `fixedCosts` {number}: The total of fixed cost components such as obtaining, labeling, packaging, and flow maximum amounts.
 * - `dynamicCosts` {number}: The total of dynamic cost components like sales percentage, tax unit, advertisement percentage, and equivalent percentage.
 */
const calculateCosts =
    (price: IPriceable, percents: ObtainCoeffsDto): { fixedCosts: number, dynamicCosts: number } => {
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
 * Calculates the payable amount based on provided inputs and associated costs.
 *
 * @param {IPriceable} price - The price object that contains cost-related information.
 * @param {ObtainCoeffsDto} percents - The percentage coefficients and minimum thresholds for calculations.
 * @param {number} sum - The starting value from which calculations are performed.
 * @returns {number} The final calculated payable amount after deducting fixed and dynamic costs.
 */
export const calculatePay = (price: IPriceable, percents: ObtainCoeffsDto, sum: number): number => {
    const { fixedCosts, dynamicCosts } = calculateCosts(price, percents);
    const mil = sum * (percents.percMil / 100);
    return (
        sum -
        fixedCosts -
        (mil < percents.minMil ? toNumber(percents.minMil) : 0) -
        (sum * (dynamicCosts + (mil < percents.minMil ? 0 : toNumber(percents.percMil)))) / 100
    );
};

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

export const skusToGoodIds = (skus: string[]): string[] => {
    const goodIds: string[] = [];
    for (const sku of skus) {
        const goodId = goodCode(new StringToIOfferIdableAdapter(sku));
        if (!goodIds.includes(goodId)) goodIds.push(goodId);
    }
    return goodIds;
};

export const barCodeSkuPairs = (cards: WbCardDto[]): Map<string, string> => {
    const skus = new Map<string, string>();
    cards.forEach((card) => {
        const barcode = head(head(card.sizes).skus);
        skus.set(barcode, card.vendorCode);
    });
    return skus;
};

export type CalculateFontSizeParams = {
    doc: PDFKit.PDFDocument; // Экземпляр PDFKit документа
    text: string; // Текст, который нужно разместить
    maxTextHeight: number; // Максимальная высота текстового блока
    options?: TextOptions;
    minFontSize?: number; // Минимальный размер шрифта (по умолчанию 6)
    maxFontSize?: number; // Максимальный размер шрифта (по умолчанию 16)
};

// без теста если менять то сделать тест
export const calculateOptimalFontSize = ({
                                                     doc,
                                                     text,
                                                     maxTextHeight,
                                                     options = {},
                                                     minFontSize = 6, // Значение по умолчанию
                                                     maxFontSize = 30, // Значение по умолчанию
                                                 }: CalculateFontSizeParams): number => {
    let fontSize = minFontSize;

    // Итерация от максимального размера шрифта к минимальному
    for (let calculateFontSize = maxFontSize; calculateFontSize > minFontSize ; calculateFontSize--) {
        doc.fontSize(calculateFontSize); // Устанавливаем текущий размер шрифта

        // Высота лини с переносом
        const lineHeight = doc.currentLineHeight(true);
        // Высота текста посчитанная через жопу
        const heightOfString = doc.heightOfString(text, options);
        // Количество строк
        const totalTextHeight = Math.ceil(heightOfString / lineHeight);

        // Проверяем, помещается ли текст в указанные ограничения
        if (totalTextHeight * lineHeight <= maxTextHeight) {
            fontSize = calculateFontSize;
            break;
        }
    }

    return fontSize;
}
