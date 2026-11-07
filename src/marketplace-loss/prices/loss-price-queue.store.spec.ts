import { Test } from '@nestjs/testing';
import { MarketplaceLossModule } from '../marketplace-loss.module';
import { FIREBIRD, FirebirdModule } from '../../firebird/firebird.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LossPriceQueueStore } from './loss-price-queue.store';
import { LossStatsStore } from '../loss-stats.store';
import { OzonReturnStore } from '../../trade2006.accrual/ozon.return.store';
import { MpEventService } from '../../mp-event/mp-event.service';
import { calculateLossRates } from '../../helpers/price/marketplace.loss.stats';
import { lossPriceSignature } from './loss-price.signature';
import { LOSS_SAVED_EVENT } from './loss-price.contracts';
const at = new Date('2026-11-07T10:00:00Z');
const row = (offerId = '123', soldUnits = 10, returnedUnits = 1, writtenOffUnits = 1) => ({
    offerId,
    soldUnits,
    returnedUnits,
    writtenOffUnits,
    ...calculateLossRates({ soldUnits, returnedUnits, writtenOffUnits }),
    appliedReturnRate: 0.1,
    expenses: {
        paidReturnDelivery: 30,
        cancellationDelivery: 10,
        sellerReturnDelivery: 20,
        confirmedDefectCompensation: 5,
    },
});
const raw = (r = row()) => ({
    GOODSCODE: Number(r.offerId.split('-')[0]),
    PIECES: Number(r.offerId.split('-')[1] ?? 1),
    SOLD_UNITS: r.soldUnits,
    RETURNED_UNITS: r.returnedUnits,
    WRITTEN_OFF_UNITS: r.writtenOffUnits,
    RETURN_RATE: r.returnRate,
    DEFECT_RATE: r.defectRate,
    APPLIED_RETURN_RATE: r.appliedReturnRate,
    CALCULATED_AT: new Date('2026-11-06T10:00:00Z'),
    DATA_STATE: 'READY',
    LOSS_COSTS_VERSION: 1,
    RETURN_COST_MODE: 'ACTUAL',
    RETURN_DELIVERY_RUB: r.expenses.paidReturnDelivery,
    CANCEL_DELIVERY_RUB: r.expenses.cancellationDelivery,
    SELLER_RETURN_RUB: r.expenses.sellerReturnDelivery,
    DEFECT_COMP_RUB: r.expenses.confirmedDefectCompensation,
});
const snapshot = (service = 'WB', rows = [row()]) => ({
    service,
    preliminary: false,
    calculatedAt: at,
    period: { from: '2026-08-09', to: '2026-11-07' },
    rows,
});
const setup = (previous = [raw()]) => {
    const transaction = {
        query: jest.fn(async (sql: string) => (sql.includes('SELECT CALCULATED_AT') ? [] : previous)),
        execute: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(transaction) };
    const emitter = new EventEmitter2();
    const notify = jest.spyOn(emitter, 'emit');
    const journal = new MpEventService(pool as any);
    const queue = new LossPriceQueueStore(journal, emitter);
    return {
        transaction,
        pool,
        queue,
        notify,
        store: new LossStatsStore(pool as any, queue),
        ozonStore: new OzonReturnStore(pool as any, queue),
    };
};
describe('Сохранение статистики и устойчивой очереди одной транзакцией', () => {
    it.each(['WB', 'OZON'])('новая статистика %s и версионное событие коммитятся вместе', async (market) => {
        const s = setup();
        const next = row();
        next.expenses.cancellationDelivery = 20;
        await (market === 'OZON' ? s.ozonStore : s.store).replace(snapshot(market, [next]));
        const events = s.transaction.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO MP_EVENT'));
        expect(events).toHaveLength(1);
        expect(events[0][1].slice(0, 4)).toEqual([market, 'LOSS_PRICE', `${at.getTime()}:123`, 'pending']);
        expect(JSON.parse(events[0][1][5])).toMatchObject({
            version: 1,
            offerId: '123',
            calculatedAt: at.toISOString(),
        });
        expect(s.pool.getTransaction).toHaveBeenCalledTimes(1);
        expect(s.transaction.commit).toHaveBeenCalledTimes(1);
        expect(s.notify).toHaveBeenCalledWith(LOSS_SAVED_EVENT, market, ['123']);
        expect(s.transaction.commit.mock.invocationCallOrder[0]).toBeLessThan(s.notify.mock.invocationCallOrder[0]);
    });
    it('не создаёт задания из-за одной смены даты или пропорциональных количеств и сумм', async () => {
        const s = setup();
        const next = row('123', 20, 2, 2);
        Object.keys(next.expenses).forEach((key) => (next.expenses[key] *= 2));
        await s.store.replace(snapshot('WB', [next]));
        expect(s.transaction.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO MP_EVENT'))).toBe(false);
    });
    it.each(['queue', 'stats', 'metadata', 'commit'])(
        'сбой %s откатывает всё и не запускает отправку',
        async (failure) => {
            const s = setup([]);
            s.transaction.execute.mockImplementation(async (sql: string) => {
                if (
                    (failure === 'queue' && sql.startsWith('INSERT INTO MP_EVENT')) ||
                    (failure === 'stats' && sql.startsWith('INSERT INTO MP_LOSS_STATS')) ||
                    (failure === 'metadata' && sql.startsWith('UPDATE MP_LOSS_STATE SET CALCULATED_AT'))
                )
                    throw new Error(failure);
            });
            if (failure === 'commit') s.transaction.commit.mockRejectedValue(new Error(failure));
            await expect(s.store.replace(snapshot())).rejects.toThrow(failure);
            expect(s.transaction.rollback).toHaveBeenCalledWith(true);
            expect(s.notify).not.toHaveBeenCalled();
        },
    );
    it('пропавшие строки также создают задания, Яндекс пока их не создаёт', async () => {
        const s = setup();
        await s.store.replace(snapshot('WB', []));
        expect(s.transaction.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO MP_EVENT'))).toHaveLength(
            1,
        );
        const y = setup();
        await y.store.replace(snapshot('YANDEX'));
        expect(y.transaction.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO MP_EVENT'))).toBe(false);
        expect(y.notify).not.toHaveBeenCalled();
    });
    it('отмена до commit откатывает и заявки, и статистику', async () => {
        const s = setup([]);
        await expect(
            s.store.replace(snapshot(), {
                beforeCommit: async () => {
                    throw new Error('cancel');
                },
            }),
        ).rejects.toThrow('cancel');
        expect(s.transaction.commit).not.toHaveBeenCalled();
        expect(s.transaction.rollback).toHaveBeenCalled();
        expect(s.notify).not.toHaveBeenCalled();
    });
    it('фиксирует входы до await: последующая правка объекта не меняет сохранённое задание', async () => {
        const s = setup([]);
        const next = row();
        await s.store.replace(snapshot('WB', [next]), {
            checkpoint: async () => {
                next.offerId = '456';
                next.expenses.cancellationDelivery = 999;
            },
        });
        const event = s.transaction.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO MP_EVENT'));
        expect(JSON.parse(event[1][5]).offerId).toBe('123');
    });
});
describe('Определение изменений входов цены', () => {
    it.each(['up', 'down', 'null', 'defect', 'cost', 'mode', 'applied', 'missing'])('%s не теряется', (kind) => {
        const previous = row();
        let next: any = structuredClone(previous);
        if (kind === 'up') next.returnRate = 0.2;
        if (kind === 'down') next.returnRate = 0.05;
        if (kind === 'null') next.returnRate = null;
        if (kind === 'defect') next.defectRate = 0.2;
        if (kind === 'cost') next.expenses.cancellationDelivery = null;
        if (kind === 'mode') delete next.expenses.paidReturnDelivery;
        if (kind === 'applied') next.appliedReturnRate = 0.2;
        if (kind === 'missing') next = undefined;
        expect(lossPriceSignature('OZON', previous)).not.toBe(lossPriceSignature('OZON', next));
    });
    it('чужая применяемая доля Ozon не влияет на сравнение ВБ', () => {
        const previous = row(),
            next = { ...previous, appliedReturnRate: 0.9 };
        expect(lossPriceSignature('WB', previous)).toBe(lossPriceSignature('WB', next));
    });
});

it('Nest инжектирует запись очереди и в общее хранилище, и в адаптер Ozon', async () => {
    const s = setup([]);
    const module = await Test.createTestingModule({
        imports: [MarketplaceLossModule, FirebirdModule],
        providers: [OzonReturnStore],
    })
        .overrideProvider(FIREBIRD)
        .useValue(s.pool)
        .compile();
    try {
        await module.get(LossStatsStore).replace(snapshot('WB'));
        await module.get(OzonReturnStore).replace(snapshot('OZON'));
        const events = s.transaction.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO MP_EVENT'));
        expect(events.map(([, args]) => args[0])).toEqual(['WB', 'OZON']);
    } finally {
        await module.close();
    }
});
