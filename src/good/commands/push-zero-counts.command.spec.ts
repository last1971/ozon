import { PushZeroCountsCommand } from './push-zero-counts.command';
import { GoodServiceEnum } from '../good.service.enum';

describe('PushZeroCountsCommand', () => {
    it('обнуляет affectedSkus и кладёт count', async () => {
        const extraGoodService = { zeroBalances: jest.fn().mockResolvedValue(3) };
        const command = new PushZeroCountsCommand(extraGoodService as any);

        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['1000-10'],
            exact: false,
            tokens: ['1000'],
            affectedSkus: ['1000', '1000-10', '1000-20'],
        });

        expect(extraGoodService.zeroBalances).toHaveBeenCalledWith(GoodServiceEnum.WB, ['1000', '1000-10', '1000-20']);
        expect(result.count).toBe(3);
    });
});
