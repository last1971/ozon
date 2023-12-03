import { GoodCountsDto, ICountUpdateable } from './ICountUpdatebale';

describe('ICountUpdateble', () => {
    class TestUpdateble extends ICountUpdateable {
        async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
            if (args === '') {
                return {
                    nextArgs: '1',
                    goods: new Map<string, number>([
                        ['1', 1],
                        ['2', 2],
                    ]),
                };
            } else {
                return {
                    nextArgs: '',
                    goods: new Map<string, number>([['3', 3]]),
                };
            }
        }

        updateGoodCounts(): Promise<number> {
            return Promise.resolve(0);
        }
    }
    it('loadSkuList', async () => {
        const t = new TestUpdateble();
        await t.loadSkuList(false);
        expect(t.skuList).toEqual([]);
        await t.loadSkuList();
        expect(t.skuList).toEqual(['1', '2', '3']);
    });
});
