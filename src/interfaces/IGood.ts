import { GoodDto } from '../good/dto/good.dto';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';

export interface IGood {
    in(codes: string[]): Promise<GoodDto[]>;
    prices(codes: string[]): Promise<GoodPriceDto[]>;
    setPercents(perc: GoodPercentDto): Promise<void>;
    getPerc(codes: string[]): Promise<GoodPercentDto[]>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
