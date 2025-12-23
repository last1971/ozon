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
    private readonly MIN_PROFIT_RUB: number;
    private readonly MIN_STOCK_PERCENT: number;

    constructor(
        private readonly configService: ConfigService
    ) {
        this.MIN_PROFIT_RUB = this.configService.get<number>('MIN_PROFIT_RUB', 20);
        this.MIN_STOCK_PERCENT = this.configService.get<number>('MIN_STOCK_PERCENT', 10);
    }

    /**
     * Выбирает коэффициент FBO или FBS
     * - Выбирается тот, который ниже
     * - Но только если его остаток >= MIN_STOCK_PERCENT от общего
     */
    selectCommission(
        fboValue: number,
        fbsValue: number,
        fboCount: number,
        fbsCount: number,
    ): number {
        const total = fboCount + fbsCount;
        if (total === 0) return fbsValue;

        const fboPercent = (fboCount / total) * 100;
        const fbsPercent = (fbsCount / total) * 100;

        if (fboValue < fbsValue && fboPercent >= this.MIN_STOCK_PERCENT) {
            return fboValue;
        }
        if (fbsValue < fboValue && fbsPercent >= this.MIN_STOCK_PERCENT) {
            return fbsValue;
        }

        return fboCount > fbsCount ? fboValue : fbsValue;
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
        const incoming_price = prices?.get(product.getSku())?.incoming_price;
        return incoming_price
            ? incoming_price
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
        const payResult = calculatePay(
            initialPrice,  // нужно передать IPriceable
            service.getObtainCoeffs(),  // получаем коэффициенты
            minPrice  // передаем минимальную цену
        );
        const incomingPrice = initialPrice.available_price || initialPrice.incoming_price;
        const profit = payResult.netProfit !== undefined ? payResult.netProfit : payResult.pay - incomingPrice;
        return profit < (this.MIN_PROFIT_RUB); // Минимальный порог
    }

    private shouldAdjustNormalPrice(price: UpdatePriceDto): boolean {
        return (toNumber(price.price) - toNumber(price.min_price)) < (this.MIN_PROFIT_RUB * 2);
    }

    private shouldAdjustOldPrice(price: UpdatePriceDto): boolean {
        return (toNumber(price.old_price) - toNumber(price.price)) < (this.MIN_PROFIT_RUB * 4);
    }
}