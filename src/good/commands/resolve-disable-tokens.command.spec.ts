import { ResolveDisableTokensCommand } from './resolve-disable-tokens.command';
import { GoodServiceEnum } from '../good.service.enum';

describe('ResolveDisableTokensCommand', () => {
    const skuList = ['1000', '1000-10', '1000-20', '2500', '2500-5'];
    const extraGoodService = { getSkuList: jest.fn().mockReturnValue(skuList) };
    const command = new ResolveDisableTokensCommand(extraGoodService as any);

    beforeEach(() => jest.clearAllMocks());

    it('level=good: token с префиксом, affectedSkus=все фасовки товара', async () => {
        const result = await command.execute({ service: GoodServiceEnum.WB, inputSkus: ['1000'], level: 'good' });
        expect(result.tokens).toEqual(['good:1000']);
        expect(result.affectedSkus).toEqual(['1000', '1000-10', '1000-20']);
        expect(result.stopChain).toBeUndefined();
    });

    it('level=sku: token без префикса, affectedSkus=сам код, getSkuList не зовётся', async () => {
        const result = await command.execute({ service: GoodServiceEnum.WB, inputSkus: ['1000-10'], level: 'sku' });
        expect(result.tokens).toEqual(['1000-10']);
        expect(result.affectedSkus).toEqual(['1000-10']);
        expect(extraGoodService.getSkuList).not.toHaveBeenCalled();
    });

    it('чистит и дедуплицирует вход', async () => {
        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: [' 1000-10 ', '1000-10', '', '1000-20'],
            level: 'sku',
        });
        expect(result.tokens).toEqual(['1000-10', '1000-20']);
    });

    it('пустой ввод → stopChain + error', async () => {
        const result = await command.execute({ service: GoodServiceEnum.WB, inputSkus: ['', '  '], level: 'good' });
        expect(result.stopChain).toBe(true);
        expect(result.tokens).toEqual([]);
        expect(result.errors[0]).toContain('Не передано ни одного SKU');
    });
});
