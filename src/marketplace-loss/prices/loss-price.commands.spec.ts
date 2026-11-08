import { lossExpensesPerSale } from '../loss-expenses';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { calculatePrice } from '../../helpers/price/price.helpers';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
import { LossPriceQueueStore } from './loss-price-queue.store';
import { LossPriceUpdateService } from './loss-price-update.service';
import { LossPriceContext, lossPriceJobKind } from './loss-price.contracts';
import {
    LoadLossPriceTasksCommand,
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
    FinishLossPriceTasksCommand,
} from './loss-price.commands';
const at = new Date('2026-11-07T10:00:00Z');
const event = (offerId = '123', date = at) => ({
    extId: `${date.getTime()}:${offerId}`,
    state: 'pending',
    posting: null,
    firstSeen: date,
    payload: { version: 1, offerId, calculatedAt: date.toISOString() },
});
const input = (offer_id = '123', incoming_price = 100) => ({
    offer_id,
    incoming_price,
    available_price: 0,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    adv_perc: 0,
    sum_pack: 0,
    sales_percent: 20,
    fbs_direct_flow_trans_max_amount: 10,
    lossCosts: {
        purchaseCost: 100,
        defectRate: 0.1,
        confirmedDefectCompensation: 0,
        paidReturnDelivery: 3,
        cancellationDelivery: 1,
        sellerReturnDelivery: 2,
    },
});
const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
const matches = (target, actual) =>
    !!actual && ['price', 'old_price', 'min_price'].every((k) => target[k] === actual[k]);
function setup(offers = ['123'], service: 'WB' | 'OZON' = 'WB') {
    const pending = new Map(
        offers.map((id) => {
            const row = event(id);
            return [row.extId, row];
        }),
    );
    const journal = {
        listUnhandledRows: jest.fn(async () => [...pending.values()]),
        markHandled: jest.fn(async (key) => {
            pending.delete(key.extId);
        }),
        updatePendingPayload: jest.fn(async (key, payload) => {
            pending.get(key.extId)!.payload = payload;
        }),
    };
    const queue = new LossPriceQueueStore(journal as any);
    const current = new Map<string, any>();
    const adapter = {
        pricing: { getObtainCoeffs: () => coeffs } as any,
        offers: jest.fn().mockResolvedValue(offers),
        current: jest.fn(async () => new Map(current)),
        matches,
        persist: jest.fn().mockResolvedValue(undefined),
        send: jest.fn(async (targets) => {
            targets.forEach((t) => current.set(t.offer_id, structuredClone(t)));
            return new Map<string, string | null>(targets.map((t) => [t.offer_id, null]));
        }),
        promos: jest.fn(async (ids: string[]) =>
            priceUpdateQueue.run(service.toLowerCase(), async () => new Map(ids.map((id) => [id, null]))),
        ),
    };
    const rows = offers.map((offerId) => ({
        offerId,
        soldUnits: 10,
        defectRate: 0.1,
        expenses: {
            paidReturnDelivery: 30,
            cancellationDelivery: 10,
            sellerReturnDelivery: 20,
            confirmedDefectCompensation: 0,
        },
    }));
    const stats = { read: jest.fn().mockResolvedValue({ service, rows }) };
    const goods = { buildPriceables: jest.fn(async (_, ids) => ids.map((id) => input(id))) };
    const config = new ConfigService({ SERVICES: [service.toLowerCase()], PRICE_VERIFY_DELAY_MS: 0 });
    const load = new LoadLossPriceTasksCommand(queue);
    const calculate = new CalculateLossPriceTargetsCommand(goods as any);
    const compare = new CompareLossPricesCommand(),
        send = new SendLossPricesCommand();
    const confirm = new ConfirmLossPricesCommand(config),
        promos = new CheckLossPricePromosCommand();
    const finish = new FinishLossPriceTasksCommand(queue);
    const makeWorker = (jobs = new JobService()) => ({
        jobs,
        worker: new LossPriceUpdateService(
            config,
            jobs,
            { [service]: adapter } as any,
            load,
            calculate,
            compare,
            send,
            confirm,
            promos,
            finish,
        ),
    });
    const { worker, jobs } = makeWorker();
    const ctx: LossPriceContext = { service, adapter, tasks: [], sent: 0, progress: emptyProgress() };
    const run = async () => jobs.whenDone(worker.start(service, 'browser').id);
    return {
        pending,
        journal,
        queue,
        adapter,
        current,
        stats,
        rows,
        goods,
        config,
        worker,
        jobs,
        makeWorker,
        ctx,
        load,
        calculate,
        compare,
        send,
        confirm,
        promos,
        finish,
        run,
    };
}
beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());
describe('Каждая команда очереди цен', () => {
    it('чтение объединяет версии своей фасовки и оставляет повреждённые задания с ошибкой', async () => {
        const s = setup();
        const second = event('123', new Date(at.getTime() + 1000));
        s.pending.set(second.extId, second);
        const invalid = event('456');
        invalid.payload.version = 2;
        s.pending.set(invalid.extId, invalid);
        await s.load.execute(s.ctx);
        expect(s.ctx.tasks).toHaveLength(2);
        expect(s.ctx.tasks[0].events).toHaveLength(2);
        expect(s.ctx.tasks[1].error).toContain('Повреждённое');
        expect(s.journal.listUnhandledRows).toHaveBeenCalledWith('WB', 'LOSS_PRICE', 'pending');
    });
    it('расчёт использует общий сборщик и формулу, сопоставляет 123 и 123-1', async () => {
        const s = setup();
        s.adapter.offers.mockResolvedValue(['123-1']);
        await s.load.execute(s.ctx);
        await s.calculate.execute(s.ctx);
        expect(s.ctx.tasks[0].targets).toEqual([calculatePrice(input('123-1'), coeffs)]);
        expect(s.goods.buildPriceables).toHaveBeenCalledWith(
            s.adapter.pricing,
            ['123-1'],
            undefined,
            expect.any(Function),
        );
    });
    it.each(['card', 'base', 'partial'])('не отправляет при неполных данных: %s', async (kind) => {
        const s = setup();
        if (kind === 'card') s.adapter.offers.mockResolvedValue([]);
        if (kind === 'base') s.goods.buildPriceables.mockRejectedValue(new Error('Нет базы'));
        if (kind === 'partial') s.goods.buildPriceables.mockResolvedValue([]);
        const done = await s.run();
        expect(done.status).toBe('done');
        expect((done.result as any).pending).toHaveLength(1);
        expect(s.pending.size).toBe(1);
        expect(s.adapter.send).not.toHaveBeenCalled();
        expect(s.adapter.promos).not.toHaveBeenCalled();
    });
    it('сравнение пропускает стоящие суммы, но сохраняет новый пол ВБ', async () => {
        const s = setup();
        s.current.set('123', calculatePrice(input(), coeffs));
        const done = await s.run();
        expect(done.status).toBe('done');
        expect(s.pending.size).toBe(0);
        expect(s.adapter.send).not.toHaveBeenCalled();
        expect(s.adapter.persist).toHaveBeenCalledWith([calculatePrice(input(), coeffs)]);
        expect(s.adapter.promos).toHaveBeenCalledWith(['123'], expect.any(Map));
    });
    it('частичный отказ пачки не мешает завершению остальных товаров', async () => {
        const s = setup(['123', '456']);
        s.adapter.send.mockImplementation(async (targets) => {
            targets.filter((t) => t.offer_id === '123').forEach((t) => s.current.set(t.offer_id, t));
            return new Map(targets.map((t) => [t.offer_id, t.offer_id === '456' ? 'Отказ API' : null]));
        });
        const done = await s.run();
        expect((done.result as any).completed).toBe(1);
        expect(s.pending.size).toBe(1);
        expect([...s.pending.values()][0].payload).toMatchObject({
            offerId: '456',
            attempts: 1,
            lastError: 'Отказ API',
        });
        expect(s.adapter.promos).toHaveBeenCalledWith(['123'], expect.any(Map));
    });
    it('нет подтверждения API — задание остаётся, пропавший ответ не считается успехом', async () => {
        const s = setup();
        s.adapter.send.mockResolvedValue(new Map());
        await s.run();
        expect(s.pending.size).toBe(1);
        expect([...s.pending.values()][0].payload['lastError']).toContain('Нет подтверждения');
    });
    it('асинхронное принятие не равно применению; после рестарта стоит та же цена — повторной отправки нет', async () => {
        const s = setup();
        s.adapter.send.mockImplementation(async (targets) => new Map(targets.map((t) => [t.offer_id, null])));
        await s.run();
        expect(s.pending.size).toBe(1);
        expect(s.adapter.promos).not.toHaveBeenCalled();
        s.current.set('123', calculatePrice(input(), coeffs));
        const recovered = s.makeWorker();
        recovered.worker.onApplicationBootstrap();
        const job = recovered.jobs.list(lossPriceJobKind('WB'))[0];
        await recovered.jobs.whenDone(job.id);
        expect(s.pending.size).toBe(0);
        expect(s.adapter.send).toHaveBeenCalledTimes(1);
        expect(s.adapter.promos).toHaveBeenCalledTimes(1);
    });
    it('ошибка акции сохраняет очередь, повтор проверяет акцию без повторной отправки сумм', async () => {
        const s = setup();
        s.adapter.promos.mockRejectedValueOnce(new Error('Сбой акции'));
        await s.run();
        expect(s.pending.size).toBe(1);
        await s.run();
        expect(s.pending.size).toBe(0);
        expect(s.adapter.send).toHaveBeenCalledTimes(1);
    });
    it('фиксация старой версии не удаляет событие нового снимка', async () => {
        const s = setup();
        await s.load.execute(s.ctx);
        const newer = event('123', new Date(at.getTime() + 1000));
        s.pending.set(newer.extId, newer);
        await s.finish.execute(s.ctx);
        expect([...s.pending.keys()]).toEqual([newer.extId]);
    });
    it('длинные проходы идут пакетами до 100 и показывают общий процент', async () => {
        const s = setup(Array.from({ length: 205 }, (_, i) => String(i + 1)));
        const done = await s.run();
        expect(done.progress.percent).toBe(100);
        expect(s.adapter.send.mock.calls.map(([batch]) => batch.length)).toEqual(Array(205).fill(1));
        expect(s.goods.buildPriceables.mock.calls.map(([, batch]) => batch.length)).toEqual([100, 100, 5]);
        expect(s.adapter.promos.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 5]);
        expect(s.pending.size).toBe(0);
    });
});
describe('Организация очереди и совместимость ручных/автоматических запусков', () => {
    it('расчёт не занимает очередь; запись ждёт текущую операцию, вложенная проверка не блокируется', async () => {
        const s = setup();
        let release: () => void;
        const held = priceUpdateQueue.run(
            'wb',
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        while (!release) await new Promise<void>((resolve) => setImmediate(resolve));
        const job = s.worker.start('WB');
        while (!s.goods.buildPriceables.mock.calls.length) await new Promise<void>((resolve) => setImmediate(resolve));
        expect(s.adapter.send).not.toHaveBeenCalled();
        release();
        await held;
        expect((await s.jobs.whenDone(job.id)).status).toBe('done');
        expect(s.pending.size).toBe(0);
    });
    it('повторный запуск объединяется; отключённые площадки и Яндекс отклоняются', async () => {
        const s = setup();
        const first = s.worker.start('WB');
        const second = s.worker.start('WB');
        expect(first.id).toBe(second.id);
        expect(() => s.worker.start('OZON')).toThrow('не подключена');
        expect(() => s.worker.start('YANDEX')).toThrow('только');
        await s.jobs.whenDone(first.id);
        expect(s.adapter.send).toHaveBeenCalledTimes(1);
    });
    it('новый снимок во время обработки запускает следующий проход и использует свежий расчёт', async () => {
        const s = setup();
        let changed = false;
        s.adapter.send.mockImplementation(async (targets) => {
            targets.forEach((t) => s.current.set(t.offer_id, structuredClone(t)));
            if (!changed) {
                changed = true;
                const next = event('123', new Date(at.getTime() + 1000));
                s.pending.set(next.extId, next);
                s.goods.buildPriceables.mockImplementation(async (_, ids) => ids.map((id) => input(id, 200)));
                s.worker.saved('WB');
            }
            return new Map<string, string | null>(targets.map((t) => [t.offer_id, null]));
        });
        await s.run();
        for (let i = 0; i < 100 && s.pending.size; i++) await new Promise((resolve) => setTimeout(resolve, 2));
        expect(s.pending.size).toBe(0);
        expect(s.adapter.send).toHaveBeenCalledTimes(2);
        expect(s.current.get('123').min_price).toBe(calculatePrice(input('123', 200), coeffs).min_price);
    });
    it('отмена после запроса не помечает событие обработанным', async () => {
        const s = setup();
        let release: () => void;
        s.adapter.send.mockImplementationOnce(async (targets) => {
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return new Map<string, string | null>(targets.map((t) => [t.offer_id, null]));
        });
        const job = s.worker.start('WB');
        while (!release) await new Promise<void>((resolve) => setImmediate(resolve));
        s.jobs.cancel(job.id);
        release();
        expect((await s.jobs.whenDone(job.id)).status).toBe('failed');
        expect(s.pending.size).toBe(1);
        expect(s.journal.markHandled).not.toHaveBeenCalled();
    });
});

it.each(['up', 'down'])(
    'изменение расходов %s меняет цену общей формулой, следующая версия обрабатывается',
    async (direction) => {
        const s = setup();
        const baseCost = direction === 'up' ? 10 : 100;
        s.rows[0].expenses.cancellationDelivery = baseCost;
        s.goods.buildPriceables.mockImplementation(async (_, ids) =>
            ids.map((id) => ({
                ...input(id),
                lossCosts: { purchaseCost: 100, ...lossExpensesPerSale(s.rows[0] as any) },
            })),
        );
        await s.run();
        const before = Number(s.current.get('123').min_price);
        s.rows[0].expenses.cancellationDelivery = direction === 'up' ? 100 : 10;
        const next = event('123', new Date(at.getTime() + 1000));
        s.pending.set(next.extId, next);
        await s.run();
        const after = Number(s.current.get('123').min_price);
        if (direction === 'up') expect(after).toBeGreaterThan(before);
        else expect(after).toBeLessThan(before);
        expect(s.pending.size).toBe(0);
    },
);
it('внешняя ошибка загрузки не теряет задания, успешный повтор возможен', async () => {
    const s = setup();
    s.adapter.current.mockRejectedValueOnce(new Error('API current offline'));
    expect((await s.run()).status).toBe('failed');
    expect(s.pending.size).toBe(1);
    expect((await s.run()).status).toBe('done');
    expect(s.pending.size).toBe(0);
});

it.each(['row', 'expenses', 'sales'])('очередь рассчитывает цену без полной статистики: %s', async (missing) => {
    const s = setup();
    if (missing === 'row') s.stats.read.mockResolvedValue({ service: 'WB', rows: [] });
    if (missing === 'expenses') delete s.rows[0].expenses;
    if (missing === 'sales') s.rows[0].soldUnits = 0;
    s.goods.buildPriceables.mockImplementation(async (_, ids) =>
        ids.map((id) => ({
            ...input(id),
            lossCosts: {
                purchaseCost: 100,
                defectRate: null,
                paidReturnDelivery: null,
                cancellationDelivery: null,
                sellerReturnDelivery: null,
                confirmedDefectCompensation: 0,
            },
        })),
    );
    const result = await s.run();
    expect(result.status).toBe('done');
    expect((result.result as any).completed).toBe(1);
    expect(s.pending.size).toBe(0);
    expect(s.adapter.send).toHaveBeenCalledTimes(1);
});

it('неизвестный отказ становится известным: цена пересчитывается, статистика не затирается нулём', async () => {
    const s = setup();
    s.rows[0].expenses.cancellationDelivery = null;
    s.goods.buildPriceables.mockImplementation(async (_, ids) =>
        ids.map((id) => ({
            ...input(id),
            lossCosts: { purchaseCost: 100, ...lossExpensesPerSale(s.rows[0] as any) },
        })),
    );
    await s.run();
    const before = Number(s.current.get('123').min_price);
    expect(s.rows[0].expenses.cancellationDelivery).toBeNull();
    s.rows[0].expenses.cancellationDelivery = 100;
    const next = event('123', new Date(at.getTime() + 1000));
    s.pending.set(next.extId, next);
    await s.run();
    expect(Number(s.current.get('123').min_price)).toBeGreaterThan(before);
    expect(s.pending.size).toBe(0);
    expect(s.adapter.send).toHaveBeenCalledTimes(2);
});

it('ошибка расчёта одного артикула не присваивается исправному соседу', async () => {
    const s = setup(['123', '456']);
    s.goods.buildPriceables.mockImplementation(async (_, ids) =>
        ids.map((id) => ({
            ...input(id),
            min_perc: id === '456' ? NaN : 20,
        })),
    );
    const result = await s.run();
    expect((result.result as any).completed).toBe(1);
    expect([...s.pending.values()].map((e) => e.payload.offerId)).toEqual(['456']);
    expect(s.adapter.send.mock.calls[0][0].map((t) => t.offer_id)).toEqual(['123']);
});
it('неизменная ошибка данных не запускает тот же расчёт при следующем cron', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementation(async (_, ids) => ids.map((id) => ({ ...input(id), min_perc: NaN })));
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    s.goods.buildPriceables.mockClear();
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    expect(s.goods.buildPriceables).not.toHaveBeenCalled();
    expect(s.pending.size).toBe(1);
});

it('ручной повтор обходит ожидание ошибки данных', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementationOnce(async (_, ids) =>
        ids.map((id) => ({ ...input(id), min_perc: NaN })),
    );
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(false);
    expect((await s.run()).status).toBe('done');
    expect(s.pending.size).toBe(0);
});
it('изменение подходящей фасовки возобновляет цену без нового снимка статистики', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementationOnce(async (_, ids) =>
        ids.map((id) => ({ ...input(id), min_perc: NaN })),
    );
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    s.worker.inputsChanged({ service: 'WB', offers: ['456'] });
    expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(false);
    s.worker.inputsChanged({ service: 'OZON', offers: ['123'] });
    expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(false);
    s.worker.inputsChanged({ service: 'WB', offers: ['123-1'] });
    expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(true);
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    expect(s.pending.size).toBe(0);
});
it('данные из внешнего изменения подхватываются при часовом контрольном повторе', async () => {
    const s = setup(),
        now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
        s.goods.buildPriceables.mockImplementationOnce(async (_, ids) =>
            ids.map((id) => ({ ...input(id), min_perc: NaN })),
        );
        await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
        clock.mockReturnValue(now + 3600000);
        expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(true);
        await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
        expect(s.pending.size).toBe(0);
    } finally {
        clock.mockRestore();
    }
});
it('временный сбой повторяется следующим cron без потери события', async () => {
    const s = setup(),
        now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
        s.goods.buildPriceables.mockRejectedValueOnce(new Error('API временно недоступен'));
        await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
        expect([...s.pending.values()][0].payload).toMatchObject({ retryKind: 'temporary', attempts: 1 });
        clock.mockReturnValue(now + 600000);
        expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(true);
        await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
        expect(s.pending.size).toBe(0);
    } finally {
        clock.mockRestore();
    }
});
it('рестарт повторно читает сохранённые ошибки даже после потери подсказок пробуждения', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementationOnce(async (_, ids) =>
        ids.map((id) => ({ ...input(id), min_perc: NaN })),
    );
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    const restarted = s.makeWorker();
    restarted.worker.onApplicationBootstrap();
    await restarted.jobs.whenDone(restarted.jobs.list(lossPriceJobKind('WB'))[0].id);
    expect(s.pending.size).toBe(0);
});
it('ошибка одной фасовки не мешает другой фасовке того же товара', async () => {
    const s = setup(['123', '123-5']);
    s.goods.buildPriceables.mockImplementation(async (_, ids) =>
        ids.map((id) => ({ ...input(id), min_perc: id === '123-5' ? NaN : 20 })),
    );
    const result = await s.run();
    expect((result.result as any).completed).toBe(1);
    expect([...s.pending.values()].map((r) => r.payload.offerId)).toEqual(['123-5']);
});
it('ошибка сравнения текущей цены одного товара не останавливает исправного соседа', async () => {
    const s = setup(['123', '456']);
    s.adapter.matches = (target, actual) => {
        if (target.offer_id === '456') throw new Error('Нет nmID');
        return matches(target, actual);
    };
    await s.run();
    expect([...s.pending.values()].map((r) => r.payload.offerId)).toEqual(['456']);
    expect(s.adapter.send.mock.calls[0][0].map((r) => r.offer_id)).toEqual(['123']);
});

it('общий API-сбой после ручного пробуждения не возвращает задание в старое ожидание', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementationOnce(async (_, ids) =>
        ids.map((id) => ({ ...input(id), min_perc: NaN })),
    );
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    s.adapter.current.mockRejectedValueOnce(new Error('API current offline'));
    expect((await s.run()).status).toBe('failed');
    expect(s.worker.hasReady('WB', [...s.pending.values()])).toBe(true);
    await s.jobs.whenDone(s.worker.start('WB', 'cron').id);
    expect(s.pending.size).toBe(0);
});

it('изменение цены после расчёта не перезаписывается старым заданием потерь', async () => {
    const s = setup();
    await s.load.execute(s.ctx);
    await s.calculate.execute(s.ctx);
    await s.compare.execute(s.ctx);
    await priceUpdateQueue.run('wb', async () => priceUpdateQueue.changed('wb', ['123']));
    await s.send.execute(s.ctx);
    await s.finish.execute(s.ctx);
    expect(s.adapter.send).not.toHaveBeenCalled();
    expect(s.pending.size).toBe(1);
    expect(([...s.pending.values()][0].payload as any).lastError).toContain('устарел');
});
it('ожидание подтверждения цены не занимает очередь площадки', async () => {
    const s = setup();
    let unblock: () => void;
    await s.load.execute(s.ctx);
    await s.calculate.execute(s.ctx);
    await s.compare.execute(s.ctx);
    await s.send.execute(s.ctx);
    const read = s.adapter.current.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                unblock = () => resolve(new Map(s.current));
            }),
    );
    const confirming = s.confirm.execute(s.ctx);
    while (!unblock) await new Promise(setImmediate);
    await priceUpdateQueue.run('wb', async () => 'manual', { priority: 'manual' });
    unblock();
    await confirming;
    expect(read).toHaveBeenCalled();
});
