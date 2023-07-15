export class GoodCountsDto {
    goods: Map<string, number>;
    nextArgs: any;
}
export interface ICountUpdateable {
    getGoodIds(args: any): Promise<GoodCountsDto>;
    updateGoodCounts(goods: Map<string, number>): Promise<number>;
}
