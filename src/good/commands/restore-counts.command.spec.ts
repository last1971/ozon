import { RestoreCountsCommand } from './restore-counts.command';
import { GoodServiceEnum } from '../good.service.enum';

describe('RestoreCountsCommand', () => {
    it('сводит tokens к goodCodes, тянет склад и пересчитывает', async () => {
        const goods = [{ code: '1000', quantity: 50, reserve: 0, name: 'x' }];
        const goodService = { in: jest.fn().mockResolvedValue(goods) };
        const extraGoodService = { countsChanged: jest.fn().mockResolvedValue(undefined) };
        const command = new RestoreCountsCommand(extraGoodService as any, goodService as any);

        const result = await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['1000-10'],
            level: 'sku',
            tokens: ['1000-10'],
        });

        expect(goodService.in).toHaveBeenCalledWith(['1000'], null);
        expect(extraGoodService.countsChanged).toHaveBeenCalledWith(goods);
        expect(result.count).toBe(1);
    });

    it('дедуплицирует goodCodes из нескольких фасовок', async () => {
        const goodService = { in: jest.fn().mockResolvedValue([]) };
        const extraGoodService = { countsChanged: jest.fn().mockResolvedValue(undefined) };
        const command = new RestoreCountsCommand(extraGoodService as any, goodService as any);

        await command.execute({
            service: GoodServiceEnum.WB,
            inputSkus: ['1000-10', '1000-20'],
            level: 'sku',
            tokens: ['1000-10', '1000-20'],
        });

        expect(goodService.in).toHaveBeenCalledWith(['1000'], null);
    });

    it('пустые tokens → не трогает склад', async () => {
        const goodService = { in: jest.fn() };
        const extraGoodService = { countsChanged: jest.fn() };
        const command = new RestoreCountsCommand(extraGoodService as any, goodService as any);

        await command.execute({ service: GoodServiceEnum.WB, inputSkus: [], level: 'sku', tokens: [] });

        expect(goodService.in).not.toHaveBeenCalled();
        expect(extraGoodService.countsChanged).not.toHaveBeenCalled();
    });
});
