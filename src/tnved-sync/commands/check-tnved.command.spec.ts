import { CheckTnvedCommand } from './check-tnved.command';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('CheckTnvedCommand', () => {
    it('зовёт checkTnved маркетплейса с базой прогона → items, notFound; ничего не пишет', async () => {
        const checkTnved = jest.fn().mockResolvedValue({ items: [{ offer: '1' }], notFound: ['2'] });
        const updateTnved = jest.fn();
        const base = [{ goodscode: '1', tnved: 'x', markRequired: false }];

        const progress = emptyProgress();
        const res = await new CheckTnvedCommand().execute({ service: { checkTnved, updateTnved }, opts: { market: GoodServiceEnum.WB }, base, progress });

        expect(checkTnved).toHaveBeenCalledWith(base, progress);
        expect(res.items).toEqual([{ offer: '1' }]);
        expect(res.notFound).toEqual(['2']);
        expect(updateTnved).not.toHaveBeenCalled();
    });
});
