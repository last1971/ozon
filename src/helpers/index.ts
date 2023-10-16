import { IOfferIdable } from '../interfaces/IOfferIdable';
import { IPriceable } from '../interfaces/i.priceable';
import { ObtainCoeffsDto } from './obtain.coeffs.dto';
import { AutoAction, UpdatePriceDto } from '../price/dto/update.price.dto';
import { toNumber, head } from 'lodash';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';

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
