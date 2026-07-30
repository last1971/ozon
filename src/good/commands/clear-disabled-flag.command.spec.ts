import { ClearDisabledFlagCommand } from './clear-disabled-flag.command';
import { GoodServiceEnum } from '../good.service.enum';

describe('ClearDisabledFlagCommand', () => {
    it('удаляет tokens из GOODS_DISABLED', async () => {
        const goodService = { clearGoodsDisabled: jest.fn().mockResolvedValue(undefined) };
        const command = new ClearDisabledFlagCommand(goodService as any);

        await command.execute({
            service: GoodServiceEnum.OZON,
            inputSkus: ['1000-10'],
            exact: true,
            tokens: ['1000-10'],
        });

        expect(goodService.clearGoodsDisabled).toHaveBeenCalledWith(['1000-10'], GoodServiceEnum.OZON);
    });
});
