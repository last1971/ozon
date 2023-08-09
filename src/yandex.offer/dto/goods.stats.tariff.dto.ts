export enum GoodsStatsTariffType {
    AGENCY_COMMISSION = 'AGENCY_COMMISSION',
    FULFILLMENT = 'FULFILLMENT',
    STORAGE = 'STORAGE',
    SURPLUS = 'SURPLUS',
    WITHDRAW = 'WITHDRAW',
    FEE = 'FEE',
}
export class GoodsStatsTariffDto {
    type: GoodsStatsTariffType;
    percent: number;
    amount: number;
}
