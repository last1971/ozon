export enum StockType {
    FIT = 'FIT',
}
export class StockItemDto {
    count: number;
    type: StockType;
    updatedAt: Date;
}
