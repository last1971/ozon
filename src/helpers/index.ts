import { IOfferIdable } from '../interfaces/IOfferIdable';
import { IPriceable } from '../interfaces/i.priceable';
import { ObtainCoeffsDto } from './obtain.coeffs.dto';
import { AutoAction, UpdatePriceDto } from '../price/dto/update.price.dto';
import { toNumber, head } from 'lodash';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import PDFDocument from 'pdfkit'
import TextOptions = PDFKit.Mixins.TextOptions;

export const goodCode = (value: IOfferIdable): string => value.offer_id.replace(/-.*/g, '');
export const goodQuantityCoeff = (value: IOfferIdable): any => {
    const coeff = value.offer_id.replace(/.*-/g, '');
    return coeff === value.offer_id ? 1 : parseInt(coeff);
};
export const productQuantity = (goodQuantity: number, goodCoeff: number) =>
    goodQuantity ? Math.floor(goodQuantity / goodCoeff) : 0;

export class StringToIOfferIdableAdapter implements IOfferIdable {
    offer_id: string;
    constructor(offer_id: string) {
        this.offer_id = offer_id;
    }
}

export const calculatePay = (price: IPriceable, percents: ObtainCoeffsDto, sum: number): number => {
    const mil = sum * (percents.percMil / 100);
    return (
        sum -
        toNumber(percents.sumObtain) -
        toNumber(percents.sumLabel) -
        toNumber(price.sum_pack) -
        toNumber(price.fbs_direct_flow_trans_max_amount) -
        (mil < percents.minMil ? toNumber(percents.minMil) : 0) -
        (sum *
            (toNumber(price.sales_percent) +
                toNumber(price.adv_perc) +
                (mil < percents.minMil ? 0 : toNumber(percents.percMil)) +
                toNumber(percents.percEkv))) /
            100
    );
};

export const calculatePrice = (
    price: IPriceable,
    percents: ObtainCoeffsDto,
    auto_action = AutoAction.ENABLED,
    price_strategy_enabled = AutoAction.DISABLED,
): UpdatePriceDto => {
    const calc = (percent: number, price: IPriceable): string => {
        let calcPrice = Math.ceil(
            (toNumber(price.incoming_price) * (1 + toNumber(percent) / 100) +
                toNumber(percents.sumObtain) +
                toNumber(percents.sumLabel) +
                toNumber(price.sum_pack) +
                toNumber(price.fbs_direct_flow_trans_max_amount)) /
                (1 -
                    (toNumber(price.sales_percent) +
                        toNumber(price.adv_perc) +
                        toNumber(percents.percMil) +
                        toNumber(percents.percEkv)) /
                        100),
        );
        const mil = calcPrice * (percents.percMil / 100);
        if (mil < percents.minMil) {
            calcPrice = Math.ceil(
                (toNumber(price.incoming_price) * (1 + toNumber(percent) / 100) +
                    toNumber(percents.minMil) +
                    toNumber(percents.sumObtain) +
                    toNumber(percents.sumLabel) +
                    toNumber(price.sum_pack) +
                    toNumber(price.fbs_direct_flow_trans_max_amount)) /
                    (1 - (toNumber(price.sales_percent) + toNumber(price.adv_perc) + toNumber(percents.percEkv)) / 100),
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
