import { LossStatsStore } from './loss-stats.store';
import { LossPricingService } from './loss-pricing.service';
import { LossSnapshot } from './loss.contracts';
import { calculateLossRates, lossPeriod } from '../helpers/price/marketplace.loss.stats';
import { lossPriceFields } from '../helpers/price/marketplace.loss.input';
import { calculateMarketplaceLossCosts } from '../helpers/price/marketplace.loss.costs';
const now = new Date('2026-11-07T10:00:00Z');
const expenses = {
    paidReturnDelivery: 20,
    cancellationDelivery: 30,
    sellerReturnDelivery: 40,
    confirmedDefectCompensation: 5,
};
const row = () => ({
    offerId: '123-4',
    soldUnits: 10,
    returnedUnits: 2,
    writtenOffUnits: 1,
    ...calculateLossRates({ soldUnits: 10, returnedUnits: 2, writtenOffUnits: 1 }),
    expenses: { ...expenses },
});
const snapshot = (): LossSnapshot => ({
    service: 'WB',
    preliminary: false,
    period: lossPeriod(now),
    calculatedAt: now,
    rows: [row()],
});
const setup = () => {
    const t = {
        execute: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue([]),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
    return { t, pool, store: new LossStatsStore(pool as any) };
};
const dbRow = () => ({
    SERVICE: 'WB',
    GOODSCODE: 123,
    PIECES: 4,
    SOLD_UNITS: 10,
    RETURNED_UNITS: 2,
    WRITTEN_OFF_UNITS: 1,
    RETURN_RATE: 0.2,
    DEFECT_RATE: 0.1,
    DATA_STATE: 'READY',
    CALCULATED_AT: now,
    LOSS_COSTS_VERSION: 1,
    RETURN_COST_MODE: 'ACTUAL',
    RETURN_DELIVERY_RUB: 20,
    CANCEL_DELIVERY_RUB: 30,
    SELLER_RETURN_RUB: 40,
    DEFECT_COMP_RUB: 5,
});

describe('Хранение проверенных расходов в том же снимке', () => {
    it('проценты, суммы и метаданные сохраняются одной транзакцией, отдельной таблицы нет', async () => {
        const { store, t } = setup();
        await store.replace(snapshot());
        const calls = t.execute.mock.calls;
        expect(calls.find(([sql]) => sql.startsWith('UPDATE MP_LOSS_STATS'))[1]).toEqual([
            'ACTUAL',
            20,
            30,
            40,
            5,
            'WB',
            123,
            4,
        ]);
        expect(calls.filter(([sql]) => sql.includes('MP_LOSS_STATS')).length).toBe(3); // DELETE, INSERT, UPDATE.
        expect(t.commit).toHaveBeenCalledTimes(1);
        expect(t.rollback).not.toHaveBeenCalled();
    });
    it('NULL расходов сохраняется явно; тарифная политика Ozon отличима от неизвестной суммы ВБ', async () => {
        const { store, t } = setup();
        const s = snapshot();
        s.service = 'OZON';
        delete s.rows[0].expenses.paidReturnDelivery;
        s.rows[0].expenses.cancellationDelivery = null;
        await store.replace(s);
        expect(t.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE MP_LOSS_STATS'))[1]).toEqual([
            'TARIFF',
            null,
            null,
            40,
            5,
            'OZON',
            123,
            4,
        ]);
    });
    it('ошибка сумм откатывает и количества, и расходы', async () => {
        const { store, t } = setup();
        t.execute.mockImplementation(async (sql) => {
            if (sql.startsWith('UPDATE MP_LOSS_STATS')) throw Error('Нет столбцов расходов');
        });
        await expect(store.replace(snapshot())).rejects.toThrow('Нет столбцов расходов');
        expect(t.rollback).toHaveBeenCalledWith(true);
        expect(t.commit).not.toHaveBeenCalled();
    });
    it.each([NaN, Infinity, undefined])('повреждённая сумма %s отвергается до открытия транзакции', async (value) => {
        const { store, pool } = setup();
        const s = snapshot();
        s.rows[0].expenses.cancellationDelivery = value;
        await expect(store.replace(s)).rejects.toThrow('расходы');
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it('снимок сумм фиксируется до первого await', async () => {
        const { store, t } = setup();
        const s = snapshot();
        await store.replace(s, {
            checkpoint: async () => {
                s.rows[0].expenses.cancellationDelivery = 999;
            },
        });
        expect(t.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE MP_LOSS_STATS'))[1][2]).toBe(30);
    });
    it('читает суммы из той же версии, NULL не становится нулём', async () => {
        const { store, t } = setup();
        t.query
            .mockResolvedValueOnce([
                {
                    CALCULATED_AT: now,
                    PERIOD_FROM: new Date('2026-08-09'),
                    PERIOD_TO: new Date('2026-11-07'),
                    PRELIMINARY: 1,
                },
            ])
            .mockResolvedValueOnce([{ ...dbRow(), RETURN_DELIVERY_RUB: null }]);
        const result = await store.read('WB');
        expect(result.rows[0].expenses).toEqual({ ...expenses, paidReturnDelivery: null });
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('тарифная доставка Ozon не десериализуется как неизвестный тариф ВБ', async () => {
        const { store, t } = setup();
        t.query
            .mockResolvedValueOnce([{ CALCULATED_AT: now, PRELIMINARY: 0 }])
            .mockResolvedValueOnce([{ ...dbRow(), RETURN_COST_MODE: 'TARIFF', RETURN_DELIVERY_RUB: null }]);
        expect((await store.read('OZON')).rows[0].expenses).not.toHaveProperty('paidReturnDelivery');
    });
});

describe('Передача своей статистики в цену', () => {
    it('каждая площадка читает свой снимок, чужая фасовка не подставляется', async () => {
        const store = { read: jest.fn().mockResolvedValue(snapshot()) };
        const reader = new LossPricingService(store as any);
        const result = await reader.load('WB', ['123-4', '123']);
        expect(store.read).toHaveBeenCalledWith('WB');
        expect(result.get('123-4')).toEqual({
            defectRate: 0.1,
            paidReturnDelivery: 2,
            cancellationDelivery: 3,
            sellerReturnDelivery: 4,
            confirmedDefectCompensation: 0.5,
        });
        expect(result.get('123').paidReturnDelivery).toBeNull();
    });
    it('предварительность одного товара не запрещает использовать проверенные расходы другого', async () => {
        const store = { read: async () => ({ ...snapshot(), preliminary: true }) };
        const result = await new LossPricingService(store as any).load('WB', ['123-4']);
        const input = lossPriceFields(result.get('123-4'), { code: 123, price: 25 } as any, 4).lossCosts;
        expect(calculateMarketplaceLossCosts(input, 999)).toMatchObject({ returns: 2, defects: 9.5, total: 18.5 });
    });
    it('закупка упаковки умножается один раз, рыночная база не участвует в браке', () => {
        const statistics = {
            defectRate: 0.1,
            confirmedDefectCompensation: 0,
            cancellationDelivery: 0,
            sellerReturnDelivery: 0,
        };
        expect(lossPriceFields(statistics, { price: 25, available_price: 9999 } as any, 4).lossCosts.purchaseCost).toBe(
            100,
        );
    });
    it('отсутствие закупки не подменяется рыночной базой', () => {
        const statistics = {
            defectRate: 0.1,
            confirmedDefectCompensation: 0,
            cancellationDelivery: 0,
            sellerReturnDelivery: 0,
        };
        expect(() =>
            calculateMarketplaceLossCosts(lossPriceFields(statistics, { price: null } as any, 4).lossCosts, 0),
        ).toThrow('закупочная');
    });
    it('нулевые продажи/неизвестный процент не делятся на ноль', async () => {
        const s = snapshot();
        Object.assign(s.rows[0], { soldUnits: 0, defectRate: null });
        const result = await new LossPricingService({ read: async () => s } as any).load('WB', ['123-4']);
        expect(result.get('123-4')).toMatchObject({
            defectRate: null,
            cancellationDelivery: null,
            sellerReturnDelivery: null,
        });
    });
    it('старые снимки не получают выдуманные нулевые суммы до финансового пересчёта', async () => {
        const s = snapshot();
        delete s.rows[0].expenses;
        const result = await new LossPricingService({ read: async () => s } as any).load('WB', ['123-4']);
        expect(result.get('123-4')).toMatchObject({
            defectRate: 0.1,
            paidReturnDelivery: null,
            cancellationDelivery: null,
            sellerReturnDelivery: null,
        });
        const input = lossPriceFields(result.get('123-4'), { price: 25 } as any, 4).lossCosts;
        expect(calculateMarketplaceLossCosts(input, 999)).toMatchObject({
            returns: 0,
            cancellations: 0,
            sellerReturns: 0,
            defects: 10,
            total: 10,
        });
        expect(s.rows[0].expenses).toBeUndefined();
    });
    it('пустой список не запрашивает БД, ошибка БД не выдаётся за нулевые потери', async () => {
        const store = { read: jest.fn().mockRejectedValue(Error('База недоступна')) };
        const reader = new LossPricingService(store as any);
        expect(await reader.load('WB', [])).toEqual(new Map());
        expect(store.read).not.toHaveBeenCalled();
        await expect(reader.load('WB', ['123'])).rejects.toThrow('База недоступна');
    });
});

it.each(['OZON', 'WB'])(
    'отсутствующая строка %s остаётся неизвестной, цена получает нулевые дополнительные потери',
    async (service) => {
        const s = snapshot();
        s.service = service;
        const reader = new LossPricingService({ read: async () => s } as any);
        const result = await reader.load(service, ['999']);
        const statistics = result.get('999');
        expect(statistics).toMatchObject({ defectRate: null, cancellationDelivery: null, sellerReturnDelivery: null });
        const costs = calculateMarketplaceLossCosts(
            lossPriceFields(statistics, { price: 100 } as any, 1).lossCosts,
            20,
        );
        expect(costs).toMatchObject({
            cancellations: 0,
            sellerReturns: 0,
            defects: 0,
            returns: service === 'OZON' ? 20 : 0,
        });
        if (service === 'OZON') expect(statistics).not.toHaveProperty('paidReturnDelivery');
        else expect(statistics.paidReturnDelivery).toBeNull();
        expect(s.rows).toHaveLength(1);
    },
);

it.each(['OZON', 'WB'])('без снимка %s цена получает неизвестные поля, не подставляя чужие суммы', async (service) => {
    const result = await new LossPricingService({ read: async () => null } as any).load(service, ['123-4']);
    const statistics = result.get('123-4');
    expect(statistics).toMatchObject({ defectRate: null, cancellationDelivery: null, sellerReturnDelivery: null });
    const input = lossPriceFields(statistics, { price: 25 } as any, 4).lossCosts;
    expect(calculateMarketplaceLossCosts(input, 20).total).toBe(service === 'OZON' ? 20 : 0);
});
