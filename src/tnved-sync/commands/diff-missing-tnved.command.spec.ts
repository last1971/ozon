import { DiffMissingTnvedCommand } from './diff-missing-tnved.command';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('DiffMissingTnvedCommand', () => {
    it('с ТН ВЭД — не попадает; товар есть без ТН ВЭД → noTnved; чужой код → notInBase; счётчики', async () => {
        const progress = emptyProgress();
        const res = await new DiffMissingTnvedCommand().execute({
            progress,
            market: GoodServiceEnum.WB,
            service: {} as any,
            offers: [
                { offer: '565831', goodscode: '565831', name: 'с кодом' },
                { offer: '100-10', goodscode: '100', name: 'без кода' },
                { offer: 'ABC-1', goodscode: 'ABC', name: 'чужой' },
            ],
            allGoods: new Set(['565831', '100']),
            withTnved: new Set(['565831']),
        });

        expect(res.report).toEqual({
            market: 'wb',
            offers: 3,
            noTnved: [{ offer: '100-10', goodscode: '100', name: 'без кода' }],
            notInBase: [{ offer: 'ABC-1', goodscode: 'ABC', name: 'чужой' }],
        });
        expect(progress.counters).toEqual({ offers: 3, noTnved: 1, notInBase: 1 });
    });
});
