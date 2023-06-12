import { GoodDto } from '../good/dto/good.dto';
import { GoodPriceDto } from '../good/dto/good.price.dto';

export interface IGood {
    in(codes: string[]): Promise<GoodDto[]>;
    prices(codes: string[]): Promise<GoodPriceDto[]>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
