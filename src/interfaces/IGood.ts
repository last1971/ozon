import { GoodDto } from '../good/good.dto';

export interface IGood {
    in(codes: string[]): Promise<GoodDto[]>;
}
export const GOOD_SERVICE = 'GOOD_SERVICE';
