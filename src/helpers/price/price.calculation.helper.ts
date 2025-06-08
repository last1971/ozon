import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IProductCoeffsable } from '../../interfaces/i.product.coeffsable';
import { GoodPriceDto } from '../../good/dto/good.price.dto';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { calculatePay, calculatePrice, goodCode, goodQuantityCoeff } from "../index";
import { IPriceUpdateable } from '../../interfaces/i.price.updateable';
import { GoodPercentDto } from '../../good/dto/good.percent.dto';
import { IGood } from '../../interfaces/IGood';
import { FirebirdTransaction } from "ts-firebird";
import { IPriceable } from "../../interfaces/i.priceable";
import { toNumber } from "lodash";

@Injectable()
export class PriceCalculationHelper {
    private readonly PERCENT_STEP = 10;
    private PRICE_DIFF_THRESHOLD: number;
    constructor(
        private readonly configService: ConfigService
    ) {
        this.PRICE_DIFF_THRESHOLD = this.configService.get<number>('MIN_MIL', 20);
    }

    async preparePricesContext(
        service: IPriceUpdateable,
        skus: string[],
        goodService: IGood,
        transaction: FirebirdTransaction = null,
    ): Promise<{
        codes: string[];
        goods: GoodPriceDto[];
        percents: GoodPercentDto[];
        products: IProductCoeffsable[];
    }> {
        const codes = skus.map((item) => goodCode({ offer_id: item }));
        const goods = await goodService.prices(codes, transaction);
        const percents = await goodService.getPerc(codes, transaction);
        const products = await service.getProductsWithCoeffs(skus);
        
        return { codes, goods, percents, products };
    }

    getIncomingPrice(
        product: IProductCoeffsable, 
        goods: GoodPriceDto[], 
        prices?: Map<string, UpdatePriceDto>
    ): number {
        const gCode = goodCode({ offer_id: product.getSku() });
        const gCoeff = goodQuantityCoeff({ offer_id: product.getSku() });
        return prices?.get(product.getSku())?.incoming_price
            ? prices.get(product.getSku()).incoming_price
            : goods.find((g) => g.code.toString() === gCode)?.price * gCoeff;
    }

    getInitialPercents(incoming_price: number = 0): { min_perc: number; perc: number; old_perc: number } {
        const minPercent = this.configService.get<number>('MIN_PROFIT_PERC', 10);
        const basePercent = this.configService.get<number>('MIN_PROFIT_TARGET', 103);
        const priceOffset = this.configService.get<number>('PRICE_SMOOTHING_OFFSET', 500);
        let old_perc: number, perc: number, min_perc: number;

        if (incoming_price) {
            const base = minPercent + basePercent / (incoming_price + priceOffset) * 100;
            old_perc = Math.round(base * 4);
            perc = Math.round(base * 2);
            min_perc = Math.round(base);
        } else {
            old_perc = this.configService.get<number>('PERC_MAX', 80);
            perc = this.configService.get<number>('PERC_NOR', 40);
            min_perc = this.configService.get<number>('PERC_MIN', 20);
        }
        return { old_perc, perc, min_perc };
    }

    getDefaultPercents(packing_price: number = null): GoodPercentDto {
        return {
            adv_perc: 0,
            old_perc: this.configService.get<number>('PERC_MAX', 80),
            perc: this.configService.get<number>('PERC_NOR', 40),
            min_perc: this.configService.get<number>('PERC_MIN', 20),
            packing_price: packing_price ?? this.configService.get<number>('SUM_PACK', 10),
            available_price: 0,
            offer_id: '',
            pieces: 1
        };
    }

    adjustPercents(
        initialPrice: IPriceable,
        service: IPriceUpdateable
    ): { min_perc: number; perc: number; old_perc: number } {
        let { min_perc, perc, old_perc } = this.getInitialPercents(
            initialPrice.available_price != null && initialPrice.available_price > 0 ? initialPrice.available_price : initialPrice.incoming_price
        );

        let calculatedPrice = this.calculatePriceWithPercents(
            initialPrice,
            service,
            min_perc,
            perc,
            old_perc
        );

        // Шаг 1: Проверяем минимальную цену
        while (this.shouldAdjustMinPrice(calculatedPrice, initialPrice, service)) {
            min_perc += this.PERCENT_STEP;
            perc = min_perc * 2;
            old_perc = perc * 2;

            calculatedPrice = this.calculatePriceWithPercents(
                initialPrice,
                service,
                min_perc,
                perc,
                old_perc
            );
        }

        // Шаг 2: Проверяем разницу между минимальной ценой и обычной ценой
        while (this.shouldAdjustNormalPrice(calculatedPrice)) {
            perc += this.PERCENT_STEP;
            old_perc = perc * 2;

            calculatedPrice = this.calculatePriceWithPercents(
                initialPrice,
                service,
                min_perc,
                perc,
                old_perc
            );
        }

        // Шаг 3: Проверяем разницу между обычной ценой и старой ценой
        while (this.shouldAdjustOldPrice(calculatedPrice)) {
            old_perc += this.PERCENT_STEP;

            calculatedPrice = this.calculatePriceWithPercents(
                initialPrice,
                service,
                min_perc,
                perc,
                old_perc
            );
        }

        return { min_perc, perc, old_perc };
    }

    private calculatePriceWithPercents(
        price: IPriceable,
        service: IPriceUpdateable,
        min_perc: number,
        perc: number,
        old_perc: number
    ): UpdatePriceDto {
        return calculatePrice(
            {
                ...price,
                min_perc,
                perc,
                old_perc,
            },
            service.getObtainCoeffs()
        );
    }

    private shouldAdjustMinPrice(price: UpdatePriceDto, initialPrice: IPriceable, service: IPriceUpdateable): boolean {
        const minPrice = toNumber(price.min_price);
        const profit = calculatePay(
            initialPrice,  // нужно передать IPriceable
            service.getObtainCoeffs(),  // получаем коэффициенты
            minPrice  // передаем минимальную цену
        ) - (initialPrice.available_price || initialPrice.incoming_price);
        return profit < (this.PRICE_DIFF_THRESHOLD / 2 + 1); // Минимальный порог
    }

    private shouldAdjustNormalPrice(price: UpdatePriceDto): boolean {
        return (toNumber(price.price) - toNumber(price.min_price)) < (this.PRICE_DIFF_THRESHOLD + 1);
    }

    private shouldAdjustOldPrice(price: UpdatePriceDto): boolean {
        return (toNumber(price.old_price) - toNumber(price.price)) < (this.PRICE_DIFF_THRESHOLD * 2 + 1);
    }
}