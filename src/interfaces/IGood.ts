import { GoodDto } from '../good/dto/good.dto';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { ICountUpdateable } from './ICountUpdatebale';
import { IPriceUpdateable } from './i.price.updateable';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';

export interface IGood {
    in(codes: string[], t: FirebirdTransaction): Promise<GoodDto[]>;
    prices(codes: string[], t: FirebirdTransaction): Promise<GoodPriceDto[]>;
    setPercents(perc: GoodPercentDto, t: FirebirdTransaction): Promise<void>;
    getPerc(codes: string[], t: FirebirdTransaction): Promise<GoodPercentDto[]>;
    setWbData(data: GoodWbDto, t: FirebirdTransaction): Promise<void>;
    getWbData(ids: string[]): Promise<GoodWbDto[]>;
    getQuantities(goodCodes: string[], t: FirebirdTransaction): Promise<Map<string, number>>;
    updateCountForService(service: ICountUpdateable, args: any): Promise<number>;
    updateCountForSkus(service: ICountUpdateable, skus: string[]): Promise<number>;
    updatePriceForService(service: IPriceUpdateable, skus: string[]): Promise<any>;
    updateWbCategory(wbCard: WbCardDto): Promise<void>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
