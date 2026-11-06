import { emptyProgress } from '../interfaces/i.job.context';
import { LoadOzonLossCatalogCommand, ApplyOzonReturnPolicyCommand, OzonLossContext } from './ozon.loss.commands';
import { OzonLossHistorySource } from './ozon.loss-history.source';
import { LoadLossHistoryCommand, CalculateLossReportCommand } from '../marketplace-loss/loss.commands';
import { buildOzonReturnSnapshot } from '../helpers/price/ozon.return.snapshot';
import { calculateLossRates, lossOfferKey } from '../helpers/price/marketplace.loss.stats';

const context = (): OzonLossContext => ({
    service: 'OZON',
    preliminary: false,
    period: { from: '2026-08-08', to: '2026-11-06' },
    calculatedAt: new Date('2026-11-06T10:00:00Z'),
    progress: emptyProgress(),
    sales: [],
    rows: [],
    writeOffs: [],
    catalog: [],
    skuToOffer: new Map(),
    knownOffers: [],
    minSales: 5,
    defaultPerc: 0.07,
});
const row = (offerId: string, soldUnits: number, returnedUnits: number) => ({
    offerId,
    soldUnits,
    returnedUnits,
    writtenOffUnits: 0,
    ...calculateLossRates({ soldUnits, returnedUnits, writtenOffUnits: 0 }),
});
const report = (rows = [{ offerId: '123', soldUnits: 3, paidReturnUnits: 3, returnPerc: 1 }]) => ({ rows, issues: [] });

describe('Источник Ozon реализует общий интерфейс истории', () => {
    it('общая цепочка принимает реальные итоги вместо выдуманных событий и дат', async () => {
        const ctx = context();
        const preview = { preview: jest.fn().mockResolvedValue(report()) };
        ctx.skuToOffer.set('10', '123');
        await new LoadLossHistoryCommand(new OzonLossHistorySource(preview, ctx)).execute(ctx);
        expect(preview.preview).toHaveBeenCalledWith('2026-08-08', '2026-11-06', new Map([['10', '123']]));
        expect(ctx.sales).toEqual([]);
        ctx.progress.done = 0;
        await new CalculateLossReportCommand().execute(ctx);
        expect(ctx.rows).toEqual([row('123', 3, 3)]);
    });
    it.each(['issues', 'unknown', 'duplicate', 'mismatch', 'over100', 'cursor'])(
        'не публикует неоднозначный отчёт: %s',
        async (problem) => {
            const data = report();
            const ctx = context();
            if (problem === 'issues') data.issues.push({ reason: 'unknown' } as never);
            if (problem === 'unknown') data.rows[0].returnPerc = null;
            if (problem === 'duplicate') data.rows.push({ ...data.rows[0] });
            if (problem === 'mismatch') data.rows[0].returnPerc = 0;
            if (problem === 'over100') {
                data.rows[0].soldUnits = 1;
                data.rows[0].returnPerc = 3;
            }
            const source = new OzonLossHistorySource({ preview: async () => data }, ctx);
            await expect(source.readPage(problem === 'cursor' ? 'bad' : ctx.period.from)).rejects.toThrow();
        },
    );
    it('алиасы суммируются по количествам, фасовки остаются раздельными', async () => {
        const ctx = context();
        const source = new OzonLossHistorySource(
            {
                preview: async () =>
                    report([
                        { offerId: '123', soldUnits: 3, paidReturnUnits: 1, returnPerc: 1 / 3 },
                        { offerId: '123-1', soldUnits: 1, paidReturnUnits: 1, returnPerc: 1 },
                        { offerId: '123-4', soldUnits: 5, paidReturnUnits: 0, returnPerc: 0 },
                    ]),
            },
            ctx,
        );
        await new LoadLossHistoryCommand(source).execute(ctx);
        ctx.progress.done = 0;
        await new CalculateLossReportCommand().execute(ctx);
        expect(ctx.rows).toEqual([row('123', 4, 2), row('123-4', 5, 0)]);
    });
    it('общий расчёт не удваивает историю при смешивании событий с готовыми итогами', async () => {
        const ctx = context();
        ctx.counts = [{ offerId: '123', soldUnits: 1, returnedUnits: 0 }];
        ctx.sales = [
            {
                id: 'S',
                offerId: '123',
                kind: 'sale',
                units: 1,
                occurredAt: '2026-10-01',
                changedAt: '2026-10-01',
                orderId: '1',
            },
        ];
        await expect(new CalculateLossReportCommand().execute(ctx)).rejects.toThrow('смешивать');
    });
});

describe('Команды каталога и выбора применяемой доли', () => {
    it('каталог проверяет настройки до API и БД', async () => {
        const ctx = context();
        ctx.minSales = 0;
        const products = { listAllOfferIds: jest.fn() };
        const store = { listKnownOffers: jest.fn() };
        await expect(new LoadOzonLossCatalogCommand(products as any, store as any).execute(ctx)).rejects.toThrow();
        expect(products.listAllOfferIds).not.toHaveBeenCalled();
        expect(store.listKnownOffers).not.toHaveBeenCalled();
    });
    it('сохраняет обе SKU и ранее известные фасовки; читает каталог порциями', async () => {
        const ctx = context();
        const offers = Array.from({ length: 101 }, (_, i) => String(i + 100));
        const products = {
            listAllOfferIds: async () => offers,
            infoList: jest.fn(async (batch) =>
                batch.map((sku) => ({ sku, marketSku: Number(sku), cabinetSku: Number(sku) + 1000 })),
            ),
        };
        const store = { listKnownOffers: async () => ['99'] };
        await new LoadOzonLossCatalogCommand(products as any, store as any).execute(ctx);
        expect(products.infoList.mock.calls.map(([batch]) => batch.length)).toEqual([100, 1]);
        expect(ctx.skuToOffer.get('1100')).toBe('100');
        expect(ctx.knownOffers).toEqual(['99']);
        expect(ctx.progress).toMatchObject({ done: 101, total: 101 });
    });
    it('50% собственных возвратов сохраняются, но при малой истории в цену идут прежние 20%', async () => {
        const ctx = context();
        ctx.catalog = [
            { sku: '123', typeId: 10 },
            { sku: '124', typeId: 10 },
            { sku: '125', typeId: 10 },
            { sku: '126' },
        ] as any;
        ctx.rows = [row('123', 2, 1), row('124', 8, 1), row('126', 1, 0)];
        ctx.knownOffers = ['999'];
        const previous = buildOzonReturnSnapshot(
            {
                issues: [],
                rows: ctx.rows.map((r) => ({
                    offerId: r.offerId,
                    soldUnits: r.soldUnits,
                    paidReturnUnits: r.returnedUnits,
                    returnPerc: r.returnRate ?? 0,
                })),
            },
            ctx.catalog,
            5,
            0.07,
        );
        await new ApplyOzonReturnPolicyCommand().execute(ctx);
        for (const value of previous)
            expect(
                ctx.rows.find((r) => r.offerId === lossOfferKey(`${value.goodscode}-${value.pieces}`))
                    .appliedReturnRate,
            ).toBe(Number(value.returnPerc.toFixed(6)));
        expect(ctx.rows.find((r) => r.offerId === '123')).toMatchObject({ returnRate: 0.5, appliedReturnRate: 0.2 });
        expect(ctx.rows.find((r) => r.offerId === '124')).toMatchObject({
            returnRate: 0.125,
            appliedReturnRate: 0.125,
        });
        expect(ctx.rows.find((r) => r.offerId === '125')).toMatchObject({ returnRate: null, appliedReturnRate: 0.07 });
        expect(ctx.rows.find((r) => r.offerId === '126')).toMatchObject({ returnRate: 0, appliedReturnRate: 0.07 });
        expect(ctx.rows.find((r) => r.offerId === '999')).toMatchObject({ returnRate: null, appliedReturnRate: 0.07 });
    });
    it('по умолчанию одна продажа достаточна; применяемая доля округляется как прежний NUMERIC(9,6)', async () => {
        const ctx = context();
        ctx.minSales = 1;
        ctx.defaultPerc = 0;
        ctx.rows = [row('123', 3, 1)];
        await new ApplyOzonReturnPolicyCommand().execute(ctx);
        expect(ctx.rows[0]).toMatchObject({ returnRate: 1 / 3, appliedReturnRate: 0.333333 });
    });
    it('отмена длинного выбора политики не переходит к сохранению', async () => {
        const ctx = context();
        ctx.knownOffers = Array.from({ length: 500 }, (_, i) => String(i + 100));
        setImmediate(() => {
            ctx.stopChain = true;
        });
        await expect(new ApplyOzonReturnPolicyCommand().execute(ctx)).rejects.toThrow('остановлена');
    });
});
