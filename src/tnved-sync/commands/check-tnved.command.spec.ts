import { CheckTnvedCommand } from './check-tnved.command';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('CheckTnvedCommand', () => {
    it('зовёт checkTnved маркетплейса с базой прогона → items, notFound; ничего не пишет', async () => {
        const checkTnved = jest.fn().mockResolvedValue({ items: [{ offer: '1' }], notFound: ['2'] });
        const updateTnved = jest.fn();
        const base = [{ goodscode: '1', tnved: 'x', markRequired: false }];

        const res = await new CheckTnvedCommand().execute({ service: { checkTnved, updateTnved }, opts: { market: GoodServiceEnum.WB }, base });

        expect(checkTnved).toHaveBeenCalledWith(base);
        expect(res.items).toEqual([{ offer: '1' }]);
        expect(res.notFound).toEqual(['2']);
        expect(updateTnved).not.toHaveBeenCalled();
    });
});
