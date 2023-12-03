export class GoodCountsDto<T> {
    goods: Map<string, T>;
    nextArgs: any;
}
export abstract class ICountUpdateable {
    abstract getGoodIds(args: any): Promise<GoodCountsDto<number>>;
    abstract updateGoodCounts(goods: Map<string, number>): Promise<number>;
    skuList: string[] = [];
    async loadSkuList(load = true): Promise<void> {
        if (!load) return;
        let args = '';
        do {
            const res = await this.getGoodIds(args);
            args = res.nextArgs;
            this.skuList = this.skuList.concat(Array.from(res.goods.keys()));
        } while (args);
    }
}
