import { JobService } from './job.service';
import { emptyProgress, IJobContext, IJobCommand } from '../interfaces/i.job.context';

const gate = () => {
    let release: () => void;
    const promise = new Promise<void>((r) => (release = r));
    return { promise, release: () => release() };
};
const tick = () => new Promise<void>((r) => setImmediate(r));
const command = (
    weight: number,
    phase: string,
    action: (c: IJobContext) => Promise<void>,
): IJobCommand<IJobContext> => ({
    weight,
    phase,
    execute: async (c) => {
        await action(c);
        return c;
    },
});

describe('Общий процент JobService', () => {
    it('считает веса и внутренний прогресс, сериализует процент в API, не сбрасывает его на новой фазе', async () => {
        const jobs = new JobService(),
            first = gate(),
            second = gate();
        const context = { progress: emptyProgress() };
        const state = jobs.run({
            kind: 'weighted',
            params: {},
            context,
            result: () => 'ok',
            commands: [
                command(20, 'чтение', async (c) => {
                    c.progress.total = 10;
                    c.progress.done = 5;
                    await first.promise;
                }),
                command(80, 'запись', async (c) => {
                    c.progress.total = 100;
                    c.progress.done = 50;
                    await second.promise;
                }),
            ],
        });
        expect(state.progress.percent).toBe(10);
        expect(JSON.parse(JSON.stringify(jobs.get(state.id))).progress.percent).toBe(10);
        first.release();
        await tick();
        expect(state.progress).toMatchObject({ phase: 'запись', done: 50, total: 100, percent: 60 });
        context.progress.done = 0;
        expect(state.progress.percent).toBe(60);
        context.progress.done = 100;
        expect(state.progress.percent).toBe(99);
        second.release();
        expect((await jobs.whenDone(state.id)).progress.percent).toBe(100);
    });
    it('неизвестный размер фазы не даёт NaN; завершённая фаза учитывается полностью', async () => {
        const jobs = new JobService(),
            g = gate();
        const state = jobs.run({
            kind: 'unknown',
            params: {},
            context: { progress: emptyProgress() },
            result: () => null,
            commands: [
                command(10, 'первая', async () => {}),
                command(30, 'вторая', async (c) => {
                    c.progress.done = NaN;
                    await g.promise;
                }),
            ],
        });
        await tick();
        expect(state.progress.percent).toBe(25);
        g.release();
        expect((await jobs.whenDone(state.id)).progress.percent).toBe(100);
    });
    it.each([-1, NaN, Infinity])('отклоняет неверный вес %s до запуска команды', (weight) => {
        const jobs = new JobService(),
            execute = jest.fn();
        expect(() =>
            jobs.run({
                kind: 'invalid',
                params: {},
                context: { progress: emptyProgress() },
                result: () => null,
                commands: [{ weight, execute }],
            }),
        ).toThrow('Вес фаз');
        expect(execute).not.toHaveBeenCalled();
        expect(jobs.list()).toEqual([]);
    });
    it('допускает нулевой вес отдельной фазы, но не всей цепочки', async () => {
        const jobs = new JobService();
        const run = (weights: number[]) =>
            jobs.run({
                kind: 'zero',
                params: {},
                context: { progress: emptyProgress() },
                result: () => null,
                commands: weights.map((weight) => command(weight, 'фаза', async () => {})),
            });
        expect(() => run([0])).toThrow('Вес фаз');
        expect((await jobs.whenDone(run([0, 10]).id)).progress.percent).toBe(100);
    });
    it('при ошибке сохраняет последний процент, не сообщает 100%', async () => {
        const jobs = new JobService();
        const state = jobs.run({
            kind: 'failure',
            params: {},
            context: { progress: emptyProgress() },
            result: () => null,
            commands: [
                command(1, 'разбор', async (c) => {
                    c.progress.total = 10;
                    c.progress.done = 4;
                    throw new Error('bad row');
                }),
            ],
        });
        expect(await jobs.whenDone(state.id)).toMatchObject({ status: 'failed', progress: { percent: 40 } });
    });
    it('без весов старый контракт прогресса не меняется', async () => {
        const jobs = new JobService();
        const state = jobs.run({
            kind: 'legacy',
            params: {},
            context: { progress: emptyProgress() },
            result: () => null,
            commands: [{ phase: 'фаза', execute: async (c) => c }],
        });
        await jobs.whenDone(state.id);
        expect(state.progress).not.toHaveProperty('percent');
    });
    it('отмена с cleanup ждёт освобождения ресурса и не запускает следующую команду', async () => {
        const jobs = new JobService(),
            work = gate(),
            cleanupGate = gate(),
            cleanup = jest.fn(() => cleanupGate.promise),
            next = jest.fn();
        const state = jobs.run({
            kind: 'resource',
            params: {},
            context: { progress: emptyProgress() },
            cleanup,
            result: () => null,
            commands: [command(1, 'запись', () => work.promise), { execute: next }],
        });
        expect(jobs.cancel(state.id).status).toBe('running');
        work.release();
        await tick();
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
        cleanupGate.release();
        expect((await jobs.whenDone(state.id)).status).toBe('failed');
    });
    it('во время необратимой фиксации отмена не объявляет успешную запись отменённой', async () => {
        const jobs = new JobService(),
            g = gate(),
            cleanup = jest.fn(async () => {});
        const state = jobs.run({
            kind: 'commit',
            params: {},
            context: { progress: emptyProgress() },
            cleanup,
            canCancel: () => false,
            result: () => 1,
            commands: [command(1, 'фиксация', () => g.promise)],
        });
        jobs.cancel(state.id);
        g.release();
        expect(await jobs.whenDone(state.id)).toMatchObject({ status: 'done', progress: { percent: 100 } });
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
    it('ошибка cleanup не становится успехом и не вызывает повторный cleanup', async () => {
        const jobs = new JobService(),
            cleanup = jest.fn(async () => {
                throw new Error('rollback failed');
            });
        const state = jobs.run({
            kind: 'cleanup-error',
            params: {},
            context: { progress: emptyProgress() },
            cleanup,
            result: () => 1,
            commands: [command(1, 'запись', async () => {})],
        });
        expect((await jobs.whenDone(state.id)).status).toBe('failed');
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
