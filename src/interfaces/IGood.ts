import { GoodDto } from '../good/dto/good.dto';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { ICountUpdateable } from './ICountUpdatebale';
import { IPriceUpdateable } from './i.price.updateable';
import { GoodWbDto } from '../good/dto/good.wb.dto';

export interface IGood {
    in(codes: string[]): Promise<GoodDto[]>;
    prices(codes: string[]): Promise<GoodPriceDto[]>;
    setPercents(perc: GoodPercentDto): Promise<void>;
    getPerc(codes: string[]): Promise<GoodPercentDto[]>;
    setWbData(data: GoodWbDto): Promise<void>;
    getWbData(ids: string[]): Promise<GoodWbDto[]>;
    getQuantities(goodCodes: string[]): Promise<Map<string, number>>;
    updateCountForService(service: ICountUpdateable, args: any): Promise<number>;
    updateCountForSkus(service: ICountUpdateable, skus: string[]): Promise<number>;
    updatePriceForService(service: IPriceUpdateable, skus: string[]): Promise<any>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
