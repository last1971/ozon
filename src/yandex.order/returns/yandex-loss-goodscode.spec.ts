import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import {
    CalculateLossReportCommand,
    LoadLossHistoryCommand,
    SaveLossSnapshotCommand,
} from '../../marketplace-loss/loss.commands';
import { SaveLossContext } from '../../marketplace-loss/loss.commands';
import { YandexFirebirdSalesSource } from './yandex-loss-history.source';

const period = { from: '2026-08-09', to: '2026-11-07' };
const row = (code: unknown, pieces = 1, quantity = 3) => ({ GOODSCODE: code, PIECES: pieces, TOTAL_QUAN: quantity });
const setup = (rows: ReturnType<typeof row>[]) => {
    const transaction = { query: jest.fn().mockResolvedValue(rows), rollback: jest.fn().mockResolvedValue(undefined) };
    const pool = { getTransaction: jest.fn().mockResolvedValue(transaction) };
    const source = new YandexFirebirdSalesSource(pool as any, 24465, period);
    return { source, transaction };
};

describe('Проверка исходного GOODSCODE Яндекса до преобразования артикула', () => {
    it.each([
        '123-1',
        '123-456',
        'AB-123',
        null,
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        '0123',
        ' 123',
        '123 ',
        '123\n',
        '1e3',
        '123.0',
        2147483648,
    ])('отклоняет повреждённый код %p вместо привязки продаж к другому товару', async (code) => {
        const { source, transaction } = setup([row(123), row(code), row(456)]);
        await expect(source.readPage(period.from)).rejects.toThrow();
        expect(transaction.rollback).toHaveBeenCalledWith(true);
    });

    it.each([123, '123', 2147483647, '2147483647'])(
        'сохраняет правильный код %p и его фасовку без изменения количества',
        async (code) => {
            const { source } = setup([row(code, 4, 12)]);
            expect(await source.readPage(period.from)).toMatchObject({
                counts: [{ offerId: `${code}-4`, soldUnits: 3, returnedUnits: null }],
                excludedGoods: [],
            });
        },
    );

    it('повреждённый код среди правильных строк завершает job без замены прежнего снимка', async () => {
        const { source } = setup([row(123), row('123-1'), row(456)]);
        const previous = { rows: [{ offerId: '123', soldUnits: 9 }] };
        let saved: unknown = previous;
        const store = {
            read: jest.fn(),
            replace: jest.fn(async (snapshot) => {
                saved = snapshot;
            }),
        };
        const context: SaveLossContext = {
            service: 'YANDEX',
            preliminary: true,
            period,
            calculatedAt: new Date('2026-11-07T10:00:00Z'),
            sales: [],
            writeOffs: [],
            rows: [],
            progress: emptyProgress(),
        };
        const jobs = new JobService();
        const job = jobs.run({
            kind: 'loss-goodscode-regression',
            params: period,
            context,
            commands: [
                new LoadLossHistoryCommand(source),
                new CalculateLossReportCommand(),
                new SaveLossSnapshotCommand(store),
            ],
            result: (c) => c.rows,
        });
        const done = await jobs.whenDone(job.id);
        expect(done.status).toBe('failed');
        expect(store.replace).not.toHaveBeenCalled();
        expect(saved).toBe(previous);
    });
});
