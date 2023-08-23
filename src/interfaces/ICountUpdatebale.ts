export class GoodCountsDto<T> {
    goods: Map<string, T>;
    nextArgs: any;
}
export interface ICountUpdateable {
    getGoodIds(args: any): Promise<GoodCountsDto<number>>;
    updateGoodCounts(goods: Map<string, number>): Promise<number>;
}
