import { WriteDisabledFlagCommand } from './write-disabled-flag.command';
import { GoodServiceEnum } from '../good.service.enum';

describe('WriteDisabledFlagCommand', () => {
    it('пишет tokens в GOODS_DISABLED', async () => {
        const goodService = { setGoodsDisabled: jest.fn().mockResolvedValue(undefined) };
        const command = new WriteDisabledFlagCommand(goodService as any);

        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['1000-10'],
            level: 'sku',
            tokens: ['1000'],
        });

        expect(goodService.setGoodsDisabled).toHaveBeenCalledWith(['1000'], GoodServiceEnum.WB);
        expect(result.tokens).toEqual(['1000']);
    });
});
