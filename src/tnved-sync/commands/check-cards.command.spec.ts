import { CheckCardsCommand } from './check-cards.command';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('CheckCardsCommand', () => {
    it('зовёт check маркетплейса с базой прогона → items, notFound; ничего не пишет', async () => {
        const check = jest.fn().mockResolvedValue({ items: [{ offer: '1' }], notFound: ['2'] });
        const update = jest.fn();
        const base = [{ goodscode: '1', tnved: 'x', markRequired: false }];

        const progress = emptyProgress();
        const res = await new CheckCardsCommand().execute({ service: { check, update }, opts: { market: GoodServiceEnum.WB }, progressCache: 'tnved', base, progress });

        expect(check).toHaveBeenCalledWith(base, progress);
        expect(res.items).toEqual([{ offer: '1' }]);
        expect(res.notFound).toEqual(['2']);
        expect(update).not.toHaveBeenCalled();
    });
});
