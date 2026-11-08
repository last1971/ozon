import { JobService } from './job.service';
import { addJobMetric, measureJobOperation } from './job.execution';
import { emptyProgress } from '../interfaces/i.job.context';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { of } from 'rxjs';
it('старые задания не получают новых полей, замеры включаются явно', async () => {
    const jobs = new JobService();
    for (const enabled of [false, true]) {
        const job = jobs.run({
            kind: `measure-${enabled}`,
            params: {},
            measure: enabled,
            context: { progress: emptyProgress() },
            commands: [
                {
                    phase: 'чтение',
                    execute: async (ctx) => {
                        await measureJobOperation('readMs', async () => {
                            addJobMetric('reads');
                        });
                        return ctx;
                    },
                },
            ],
            result: () => null,
        });
        const done = await jobs.whenDone(job.id);
        if (enabled) {
            expect(done.progress.metrics.phaseMs.чтение).toBeGreaterThanOrEqual(0);
            expect(done.progress.metrics.operations.reads).toBe(1);
        } else expect(done.progress.metrics).toBeUndefined();
    }
});
it('ошибка фазы сохраняет замер, а не скрывается', async () => {
    const jobs = new JobService();
    const job = jobs.run({
        kind: 'measure-fail',
        params: {},
        measure: true,
        context: { progress: emptyProgress() },
        commands: [
            {
                phase: 'запись',
                execute: async () => {
                    throw Error('fail');
                },
            },
        ],
        result: () => null,
    });
    const done = await jobs.whenDone(job.id);
    expect(done.status).toBe('failed');
    expect(done.progress.metrics.phaseMs.запись).toBeGreaterThanOrEqual(0);
});
it('ожидание очереди относится к автору запроса, не к соседнему заданию', async () => {
    const jobs = new JobService();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((r) => (started = r));
    const gate = new Promise<void>((r) => (release = r));
    const owner = priceUpdateQueue.run('metrics', async () => {
        started();
        await gate;
    });
    await entered;
    const job = jobs.run({
        kind: 'measure-queue',
        params: {},
        measure: true,
        context: { progress: emptyProgress() },
        commands: [
            {
                execute: async (ctx) => {
                    await priceUpdateQueue.run('metrics', async () => {});
                    return ctx;
                },
            },
        ],
        result: () => null,
    });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await owner;
    const done = await jobs.whenDone(job.id);
    expect(done.progress.metrics.operations.queueWaits).toBe(1);
    expect(done.progress.metrics.operations.queueWaitMs).toBeGreaterThan(0);
});
it('Ozon POST чтения отделяется от изменения цены, секреты не попадают в замеры', async () => {
    const api = new OzonApiService(
        { post: () => of({ data: {} }) } as any,
        { get: async () => ({ URL: 'https://example.invalid', API_KEY: 'secret', CLIENT_ID: 'id' }) } as any,
    );
    const jobs = new JobService();
    const job = jobs.run({
        kind: 'measure-api',
        params: {},
        measure: true,
        context: { progress: emptyProgress() },
        commands: [
            {
                execute: async (ctx) => {
                    await api.method('/v5/product/info/prices', {});
                    await api.method('/v1/product/import/prices', {});
                    return ctx;
                },
            },
        ],
        result: () => null,
    });
    const done = await jobs.whenDone(job.id);
    const m = done.progress.metrics.operations;
    expect(m.apiRequests).toBe(2);
    expect(m.apiReadMs).toBeGreaterThanOrEqual(0);
    expect(m.apiWriteMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(done.progress.metrics)).not.toContain('secret');
});

it('ошибка лимита API и время повтора сохраняются в той же задаче', async () => {
    const { WbApiService } = await import('../wb.api/wb.api.service');
    const { throwError } = await import('rxjs');
    const post = jest
        .fn()
        .mockReturnValueOnce(throwError(() => ({ response: { status: 429 }, config: {} })))
        .mockReturnValueOnce(of({ data: { data: { id: 1 } } }));
    const api = new WbApiService(
        { post } as any,
        { get: async () => ({ API_TOKEN: 'secret' }) } as any,
        { decide: () => 0 } as any,
    );
    const jobs = new JobService();
    const job = jobs.run({
        kind: 'measure-limit',
        params: {},
        measure: true,
        context: { progress: emptyProgress() },
        commands: [
            {
                execute: async (ctx) => {
                    await api.method(
                        'https://discounts-prices-api.wildberries.ru/api/v2/upload/task',
                        'post',
                        {},
                        true,
                    );
                    return ctx;
                },
            },
        ],
        result: () => null,
    });
    const done = await jobs.whenDone(job.id);
    const m = done.progress.metrics.operations;
    expect(done.status).toBe('done');
    expect(m.apiRequests).toBe(2);
    expect(m.rateLimits).toBe(1);
    expect(m.apiErrors).toBe(1);
    expect(m.apiRetryWaitMs).toBeGreaterThanOrEqual(0);
});
