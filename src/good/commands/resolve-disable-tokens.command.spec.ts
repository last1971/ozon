import { ResolveDisableTokensCommand } from './resolve-disable-tokens.command';
import { GoodServiceEnum } from '../good.service.enum';

describe('ResolveDisableTokensCommand', () => {
    const skuList = ['1000', '1000-10', '1000-20', '2500', '2500-5'];
    const extraGoodService = { getSkuList: jest.fn().mockReturnValue(skuList) };
    const command = new ResolveDisableTokensCommand(extraGoodService as any);

    beforeEach(() => jest.clearAllMocks());

    it('весь товар (exact=false): tokens=goodCode, affectedSkus=все фасовки', async () => {
        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['1000-10'],
            exact: false,
        });
        expect(result.tokens).toEqual(['1000']);
        expect(result.affectedSkus).toEqual(['1000', '1000-10', '1000-20']);
        expect(result.stopChain).toBeUndefined();
    });

    it('точная фасовка (exact=true): tokens=affectedSkus=сам SKU', async () => {
        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['1000-10'],
            exact: true,
        });
        expect(result.tokens).toEqual(['1000-10']);
        expect(result.affectedSkus).toEqual(['1000-10']);
        expect(extraGoodService.getSkuList).not.toHaveBeenCalled();
    });

    it('чистит и дедуплицирует вход', async () => {
        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: [' 1000-10 ', '1000-20', '', '1000-10'],
            exact: false,
        });
        expect(result.tokens).toEqual(['1000']);
    });

    it('пустой ввод → stopChain + error', async () => {
        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['', '  '],
            exact: false,
        });
        expect(result.stopChain).toBe(true);
        expect(result.tokens).toEqual([]);
        expect(result.errors[0]).toContain('Не передано ни одного SKU');
    });
});
