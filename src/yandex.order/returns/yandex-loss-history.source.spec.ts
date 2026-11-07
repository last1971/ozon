import { YandexFirebirdSalesSource } from './yandex-loss-history.source';
import { CalculateLossReportCommand, LoadLossHistoryCommand } from '../../marketplace-loss/loss.commands';
import { LossContext } from '../../marketplace-loss/loss.contracts';
import { emptyProgress } from '../../interfaces/i.job.context';

const period = { from: '2026-08-09', to: '2026-11-07' };
const row = (code = 123, pieces: number = 4, quantity = 12) => ({
    GOODSCODE: code,
    PIECES: pieces,
    TOTAL_QUAN: quantity,
});
function setup(rows = [row()]) {
    const t = { query: jest.fn().mockResolvedValue(rows), rollback: jest.fn().mockResolvedValue(undefined) };
    const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
    const source = new YandexFirebirdSalesSource(pool as any, 24465, period);
    const ctx: LossContext = {
        service: 'YANDEX',
        preliminary: false,
        period,
        sales: [],
        rows: [],
        writeOffs: [],
        progress: emptyProgress(),
    };
    const run = async () => {
        await new LoadLossHistoryCommand(source).execute(ctx);
        ctx.progress.done = 0;
        await new CalculateLossReportCommand().execute(ctx);
        return ctx;
    };
    return { source, t, pool, ctx, run };
}
describe('Продажи Яндекса из счетов', () => {
    it('запрашивает статусы 4 и 5, свой кабинет, 90 московских суток без сегодня', async () => {
        const { source, t } = setup();
        await source.readPage(period.from);
        expect(t.query).toHaveBeenCalledWith(
            expect.stringContaining('S.STATUS IN (4, 5)'),
            [24465, new Date('2026-08-08T21:00:00Z'), new Date('2026-11-06T21:00:00Z')],
            false,
        );
        // Отдельные строки: агрегирование не скрывает две несовместимые дробные упаковки.
        expect(t.query.mock.calls[0][0]).not.toContain('SUM(');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('суммирует точные количества упаковок; 3 продажи и списание дают 1/3 брака, возвраты неизвестны', async () => {
        const { ctx, run } = setup([row(123, 4, 8), row(123, 4, 4)]);
        ctx.writeOffs = [
            {
                id: 1,
                service: 'YANDEX',
                goodscode: '123',
                pieces: 4,
                units: 1,
                quan: 4,
                spisCode: 42,
                spisSs: 1,
                spisAt: new Date('2026-10-22'),
                documentQuantity: 4,
            },
        ];
        const result = await run();
        expect(result.rows).toEqual([
            expect.objectContaining({
                offerId: '123-4',
                soldUnits: 3,
                writtenOffUnits: 1,
                defectRate: 1 / 3,
                returnedUnits: null,
                returnRate: null,
            }),
        ]);
        expect(result.preliminary).toBe(true);
    });
    it.each([null, 0, 1.5, -1])(
        'неизвестная/некорректная фасовка %s исключает все фасовки товара, другие продолжают считаться',
        async (pieces) => {
            const { ctx, run } = setup([row(123, 4, 12), row(123, pieces, 2), row(456, 1, 10)]);
            ctx.writeOffs = [
                {
                    id: 1,
                    service: 'YANDEX',
                    goodscode: '123',
                    pieces: 4,
                    units: 1,
                    quan: 4,
                    spisCode: 42,
                    spisSs: 1,
                    spisAt: new Date('2026-10-22'),
                    documentQuantity: 4,
                },
            ];
            const result = await run();
            expect(result.rows.map((r) => r.offerId)).toEqual(['456']);
            expect(result.excludedGoods).toEqual([{ goodscode: '123', reason: expect.any(String) }]);
            expect(result.progress.counters.excludedGoods).toBe(1);
        },
    );
    it('не округляет 6 штук до двух упаковок по 4, даже если две строки в сумме кратны упаковке', async () => {
        const { run } = setup([row(123, 4, 6), row(123, 4, 2)]);
        const result = await run();
        expect(result.rows).toEqual([]);
        expect(result.excludedGoods).toHaveLength(1);
    });
    it('возвраты остаются неизвестными и для списания без продаж', async () => {
        const { ctx, run } = setup([]);
        ctx.writeOffs = [
            {
                id: 1,
                service: 'YANDEX',
                goodscode: '123',
                pieces: 4,
                units: 1,
                quan: 4,
                spisCode: 42,
                spisSs: 1,
                spisAt: new Date('2026-10-22'),
                documentQuantity: 4,
            },
        ];
        expect((await run()).rows[0]).toMatchObject({
            soldUnits: 0,
            returnedUnits: null,
            returnRate: null,
            defectRate: null,
        });
    });
    it.each([null, -1, NaN, 0.2])('повреждённое количество %s не превращается в пустой снимок', async (quantity) => {
        const { source, t } = setup([row(123, 4, quantity)]);
        await expect(source.readPage(period.from)).rejects.toThrow('количество');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('в длинном цикле уступает event loop', async () => {
        const { source } = setup(Array.from({ length: 1500 }, (_, i) => row(i + 1, 1, 1)));
        let reached = false;
        setImmediate(() => {
            reached = true;
        });
        await source.readPage(period.from);
        expect(reached).toBe(true);
    });
});
