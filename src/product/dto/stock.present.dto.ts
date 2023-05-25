import { StockType } from '../stock.type';

export class StockPresentDto {
    type: StockType;
    present: number;
    reserved: number;
}
