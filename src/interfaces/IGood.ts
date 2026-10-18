import { GoodDto } from '../good/dto/good.dto';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { IPriceUpdateable } from './i.price.updateable';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { WbCommissionDto } from '../wb.card/dto/wb.commission.dto';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { IPriceable } from './i.priceable';
import { PricesContextDto } from '../helpers/dto/prices.context.dto';
import { TierThresholdsDto } from '../helpers/price/quantity.tiers.helper';

export interface IGood {
    /** Транзакция для чтения нескольких выборок из одного снимка (остаток и коды не должны разъезжаться). */
    getTransaction(): Promise<FirebirdTransaction>;
    in(codes: string[], t: FirebirdTransaction): Promise<GoodDto[]>;
    prices(codes: string[], t: FirebirdTransaction): Promise<GoodPriceDto[]>;
    setPercents(perc: GoodPercentDto, t: FirebirdTransaction): Promise<void>;
    getPerc(codes: string[], t: FirebirdTransaction): Promise<GoodPercentDto[]>;
    setWbData(data: GoodWbDto, t: FirebirdTransaction): Promise<void>;
    getWbData(ids: string[]): Promise<GoodWbDto[]>;
    getQuantities(goodCodes: string[], t: FirebirdTransaction): Promise<Map<string, number>>;
    //updateCountForService(service: ICountUpdateable, args: any): Promise<number>;
    updatePriceForService(
        service: IPriceUpdateable,
        skus: string[],
        prices?: Map<string, UpdatePriceDto>,
    ): Promise<any>;
    /**
     * Данные расчёта цены по артикулам (себестоимость, наценки, комиссия, доставка) — единственный
     * сборщик: им кормится и пересчёт цен, и проверка прибыльности заказов. Без себестоимости артикул пропускается.
     */
    buildPriceables(
        service: IPriceUpdateable | null,
        skus: string[],
        prices?: Map<string, UpdatePriceDto>,
    ): Promise<IPriceable[]>;
    /**
     * Подбор наценок по артикулам. `known` — уже загруженные себестоимости/наценки и подложенные себестоимости
     * (тот же снимок, без второго похода в базу).
     */
    generatePercentsForService(
        service: IPriceUpdateable | null,
        skus: string[],
        goodPercentsDto?: Map<string, Partial<GoodPercentDto>>,
        known?: PricesContextDto,
    ): Promise<GoodPercentDto[]>;
    /** Пороги ступеней цены от количества из Trade (PRICE.QUANMOPT/QUANOPT) по кодам товаров. */
    getQuantityThresholds(codes: string[], t?: FirebirdTransaction): Promise<Map<string, TierThresholdsDto>>;
    updatePercentsForService(
        service: IPriceUpdateable,
        skus: string[],
        goodPercentsDto?: Map<string, Partial<GoodPercentDto>>,
    ): Promise<void>;
    updateWbCategory(wbCard: WbCardDto): Promise<void>;
    getWbCategoryByName(name: string): Promise<WbCommissionDto>;
    resetAvailablePrice(goodCodes?: string[], t?: FirebirdTransaction): Promise<void>;
    getDisabledCodes(service: GoodServiceEnum, t?: FirebirdTransaction): Promise<string[]>;
    /** Товары, подлежащие маркировке (GOODS_CLASSIF.MARK_REQUIRED = 1). */
    getMarkRequiredCodes(t?: FirebirdTransaction): Promise<Set<string>>;
    /** Из переданных — те, у кого есть хоть одна строка в MARKCODES (любая, не только свободная). */
    getGoodsWithMarkCodes(goodCodes: string[], t?: FirebirdTransaction): Promise<Set<string>>;
    /** Свободные коды по номиналам: GOODSCODE → (номинал → сколько кодов). */
    getFreeMarkCodesByNominal(goodCodes: string[], t?: FirebirdTransaction): Promise<Map<string, Map<number, number>>>;
    /** Живой резерв по заказам: GOODSCODE → [количество в каждом заказе]. */
    getReservedQuantities(goodCodes: string[], t?: FirebirdTransaction): Promise<Map<string, number[]>>;
    setGoodsDisabled(codes: string[], service: GoodServiceEnum, t?: FirebirdTransaction): Promise<void>;
    clearGoodsDisabled(codes: string[], service: GoodServiceEnum, t?: FirebirdTransaction): Promise<void>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
