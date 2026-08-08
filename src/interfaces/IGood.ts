import { GoodDto } from '../good/dto/good.dto';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { ICountUpdateable } from './ICountUpdatebale';
import { IPriceUpdateable } from './i.price.updateable';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { WbCommissionDto } from '../wb.card/dto/wb.commission.dto';
import { UpdatePriceDto } from "../price/dto/update.price.dto";
import { GoodAvitoDto } from '../good/dto/good.avito.dto';
import { GoodServiceEnum } from '../good/good.service.enum';

export interface IGood {
    in(codes: string[], t: FirebirdTransaction): Promise<GoodDto[]>;
    prices(codes: string[], t: FirebirdTransaction): Promise<GoodPriceDto[]>;
    setPercents(perc: GoodPercentDto, t: FirebirdTransaction): Promise<void>;
    getPerc(codes: string[], t: FirebirdTransaction): Promise<GoodPercentDto[]>;
    setWbData(data: GoodWbDto, t: FirebirdTransaction): Promise<void>;
    getWbData(ids: string[]): Promise<GoodWbDto[]>;
    setAvitoData(data: GoodAvitoDto, t: FirebirdTransaction): Promise<void>;
    getAvitoData(ids: string[]): Promise<GoodAvitoDto[]>;
    getAllAvitoGoods(): Promise<GoodAvitoDto[]>;
    getQuantities(goodCodes: string[], t: FirebirdTransaction): Promise<Map<string, number>>;
    //updateCountForService(service: ICountUpdateable, args: any): Promise<number>;
    updatePriceForService(service: IPriceUpdateable, skus: string[], prices?: Map<string, UpdatePriceDto>): Promise<any>;
    generatePercentsForService(service: IPriceUpdateable | null, skus: string[], goodPercentsDto?: Map<string, Partial<GoodPercentDto>>): Promise<GoodPercentDto[]>;
    updatePercentsForService(service: IPriceUpdateable, skus: string[], goodPercentsDto?: Map<string, Partial<GoodPercentDto>>): Promise<void>;
    updateWbCategory(wbCard: WbCardDto): Promise<void>;
    getWbCategoryByName(name: string): Promise<WbCommissionDto>;
    resetAvailablePrice(goodCodes?: string[], t?: FirebirdTransaction): Promise<void>
    getDisabledCodes(service: GoodServiceEnum, t?: FirebirdTransaction): Promise<string[]>;
    /** Товары, подлежащие маркировке (GOODS_CLASSIF.MARK_REQUIRED = 1). */
    getMarkRequiredCodes(t?: FirebirdTransaction): Promise<Set<string>>;
    /** Из переданных — те, у кого есть хоть одна строка в MARKCODES (любая, не только свободная). */
    getGoodsWithMarkCodes(goodCodes: string[], t?: FirebirdTransaction): Promise<Set<string>>;
    /** Свободные коды по номиналам: GOODSCODE → (номинал → сколько кодов). */
    getFreeMarkCodesByNominal(goodCodes: string[], t?: FirebirdTransaction): Promise<Map<string, Map<number, number>>>;
    setGoodsDisabled(codes: string[], service: GoodServiceEnum, t?: FirebirdTransaction): Promise<void>;
    clearGoodsDisabled(codes: string[], service: GoodServiceEnum, t?: FirebirdTransaction): Promise<void>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
