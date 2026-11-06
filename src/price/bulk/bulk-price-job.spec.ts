import { JobService } from '../../job/job.service';
import { BulkPriceJobService } from './bulk-price-job.service';
import { CollectBulkPricesCommand } from './collect-bulk-prices.command';
import { UpdateBulkPricesCommand } from './update-bulk-prices.command';
import { ReportBulkPricesCommand } from './report-bulk-prices.command';
import { BulkPriceContext, BulkPriceSource } from './bulk-price.context';
import { emptyProgress } from '../../interfaces/i.job.context';
import { pricingWarning } from '../../helpers/price/pricing-warnings';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
const context = (source?: Partial<BulkPriceSource>): BulkPriceContext => ({
    source: { market: 'ozon', page: jest.fn(), update: jest.fn(), ...source },
    offers: [],
    rows: [],
    warnings: new Map(),
    progress: emptyProgress(),
});
const report = (rows: any[]) => ({ inputs: [], sent: [], skipped: [], response: { result: rows } });
const make = () => {
    const jobs = new JobService();
    return {
        jobs,
        bulk: new BulkPriceJobService(
            jobs,
            new CollectBulkPricesCommand(),
            new UpdateBulkPricesCommand(),
            new ReportBulkPricesCommand(),
        ),
    };
};
describe('Команды массового обновления', () => {
    it('сбор: страницы, дедупликация и остановка при повторе курсора', async () => {
        const page = jest
            .fn()
            .mockResolvedValueOnce({ offers: ['1'], next: 'a' })
            .mockResolvedValueOnce({ offers: ['1', '2'] });
        const ctx = context({ page });
        await new CollectBulkPricesCommand().execute(ctx);
        expect(ctx.offers).toEqual(['1', '2']);
        expect(page.mock.calls).toEqual([[''], ['a']]);
        page.mockResolvedValue({ offers: [], next: 'a' });
        await expect(new CollectBulkPricesCommand().execute(context({ page }))).rejects.toThrow('курсор');
    });
    it('отправка: частичный отказ Ozon, пропуск базы, отсутствие строки в ответе', async () => {
        const ctx = context({
            update: jest.fn().mockResolvedValue({
                ...report([
                    { offer_id: '1', updated: true },
                    { offer_id: '2', updated: false, errors: [{ code: 'bad', message: 'отказ' }] },
                ]),
                skipped: [{ offer_id: '3', reason: 'no-base' }],
            }),
        });
        ctx.offers = ['1', '2', '3', '4'];
        await new UpdateBulkPricesCommand().execute(ctx);
        expect(ctx.rows.map((r) => r.status)).toEqual(['accepted', 'error', 'skipped', 'error']);
        expect(ctx.rows[1].reason).toBe('bad: отказ');
        expect(ctx.progress).toMatchObject({ done: 4, total: 4, counters: { accepted: 1, error: 2, skipped: 1 } });
    });
    it('WB: принятие задачи не выдаётся за завершённое применение; already set отдельно', async () => {
        const ctx = context({
            market: 'wb',
            update: jest.fn().mockResolvedValue({
                ...report([]),
                response: {
                    results: [
                        { offer_id: '1', status: 'accepted' },
                        { offer_id: '2', status: 'unchanged' },
                        { offer_id: '3', status: 'error', message: 'Invalid data format' },
                    ],
                },
            }),
        });
        ctx.offers = ['1', '2', '3'];
        await new UpdateBulkPricesCommand().execute(ctx);
        await new ReportBulkPricesCommand().execute(ctx);
        expect(ctx.report).toMatchObject({ total: 3, accepted: 1, unchanged: 1, failed: 1, skipped: 0 });
    });
    it('ошибка пакета не мешает следующему, отмена не отправляет следующий пакет', async () => {
        const update = jest
            .fn()
            .mockRejectedValueOnce(new Error('сеть'))
            .mockResolvedValue(report([{ offer_id: '100', updated: true }]));
        const ctx = context({ update });
        ctx.offers = Array.from({ length: 101 }, (_, i) => String(i));
        await new UpdateBulkPricesCommand().execute(ctx);
        expect(update).toHaveBeenCalledTimes(2);
        expect(ctx.rows.filter((r) => r.status === 'error')).toHaveLength(100);
        expect(ctx.rows[100].status).toBe('accepted');
        const stopped = context({
            update: jest.fn(async () => {
                stopped.stopChain = true;
                return report([]);
            }),
        });
        stopped.offers = ctx.offers;
        await expect(new UpdateBulkPricesCommand().execute(stopped)).rejects.toThrow('остановлена');
        expect(stopped.source.update).toHaveBeenCalledTimes(1);
    });
    it('сквозная цепочка: прогресс 5 → 99 → 100, единая задача, сводные предупреждения', async () => {
        const { jobs, bulk } = make();
        let release: () => void;
        const wait = new Promise<void>((r) => (release = r));
        const source: BulkPriceSource = {
            market: 'ozon',
            page: async () => ({ offers: ['1', '2'] }),
            update: async () => {
                pricingWarning('Нет тарифа', '1', () => {
                    throw new Error('построчный лог');
                });
                pricingWarning('Нет тарифа', '2', () => {
                    throw new Error('построчный лог');
                });
                await wait;
                return report([
                    { offer_id: '1', updated: true },
                    { offer_id: '2', updated: true },
                ]);
            },
        };
        const state = bulk.start(source);
        expect(bulk.start(source).id).toBe(state.id);
        while (state.progress.phase !== 'Расчёт и отправка цен') await new Promise(setImmediate);
        expect(state.progress.percent).toBe(5);
        release();
        const result = await bulk.wait(state.id);
        expect(result).toMatchObject({
            total: 2,
            accepted: 2,
            failed: 0,
            warnings: [{ message: 'Нет тарифа', count: 2, examples: ['1', '2'] }],
        });
        expect(jobs.get(state.id).progress.percent).toBe(100);
    });
    it('задача, отменённая в очереди, не грузит каталог и ничего не отправляет', async () => {
        const { jobs, bulk } = make();
        let release: () => void;
        const wait = new Promise<void>((r) => (release = r));
        const occupied = priceUpdateQueue.run('ozon', () => wait);
        const ctx = context();
        const state = bulk.start(ctx.source);
        jobs.cancel(state.id);
        release();
        await occupied;
        await expect(bulk.wait(state.id)).rejects.toThrow('отменена');
        expect(ctx.source.page).not.toHaveBeenCalled();
        expect(ctx.source.update).not.toHaveBeenCalled();
    });
});
