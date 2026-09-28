import { JobService } from './job.service';
import { emptyProgress, IJobCommand, IJobContext } from '../interfaces/i.job.context';

interface Ctx extends IJobContext {
    log: string[];
}

/** Команда-фаза: ждёт «отпускания» снаружи, чтобы проверять состояние на ходу */
const gate = () => {
    let release: () => void;
    const opened = new Promise<void>((r) => (release = r));
    return { opened, release: () => release() };
};

const cmd = (name: string, phase?: string, fn?: (ctx: Ctx) => Promise<void>): IJobCommand<Ctx> => ({
    phase,
    execute: async (ctx) => {
        ctx.log.push(name);
        if (fn) await fn(ctx);
        return ctx;
    },
});

const ctx = (): Ctx => ({ progress: emptyProgress(), log: [] });

describe('JobService', () => {
    let jobs: JobService;
    beforeEach(() => (jobs = new JobService()));

    it('стартует сразу, running; после конца — done с результатом и цепочка прошла целиком', async () => {
        const g = gate();
        const state = jobs.run({
            kind: 'k',
            params: { a: 1 },
            clientId: 'c1',
            commands: [cmd('one', 'первая', () => g.opened), cmd('two', 'вторая')],
            context: ctx(),
            result: (c) => c.log.join(','),
        });

        expect(state.status).toBe('running');
        expect(state.clientId).toBe('c1');
        await new Promise((r) => setImmediate(r));
        expect(state.progress.phase).toBe('первая');

        g.release();
        const done = await jobs.whenDone(state.id);
        expect(done.status).toBe('done');
        expect(done.result).toBe('one,two');
        expect(done.progress.phase).toBe('вторая');
        expect(done.finishedAt).toBeDefined();
    });

    it('исключение в команде → failed с текстом, процесс не падает, следующая команда не идёт', async () => {
        const state = jobs.run({
            kind: 'k',
            params: {},
            commands: [
                cmd('boom', 'x', async () => {
                    throw new Error('сломалось');
                }),
                cmd('never'),
            ],
            context: ctx(),
            result: (c) => c.log,
        });

        const done = await jobs.whenDone(state.id);
        expect(done.status).toBe('failed');
        expect(done.error).toBe('сломалось');
        expect(done.result).toBeUndefined();
    });

    it('та же kind+params при running → та же задача; другие params → параллельная', async () => {
        const g = gate();
        const mk = (params: Record<string, unknown>) =>
            jobs.run({ kind: 'k', params, commands: [cmd('w', 'ж', () => g.opened)], context: ctx(), result: () => 1 });

        const a = mk({ market: 'wb' });
        const same = mk({ market: 'wb' });
        const other = mk({ market: 'ozon' });

        expect(same.id).toBe(a.id);
        expect(other.id).not.toBe(a.id);
        expect(jobs.list('k')).toHaveLength(2);

        g.release();
        await jobs.whenDone(a.id);
        // после done та же задача запускается заново
        const again = mk({ market: 'wb' });
        expect(again.id).not.toBe(a.id);
    });

    it('фаза сбрасывает done/total; команда без phase фазу не трогает; счётчики живые', async () => {
        const state = jobs.run({
            kind: 'k',
            params: {},
            commands: [
                cmd('a', 'сверка', async (c) => {
                    c.progress.total = 3;
                    c.progress.done = 3;
                    c.progress.counters.ok = 2;
                }),
                cmd('b', undefined, async (c) => {
                    c.progress.counters.ok += 1;
                }),
                cmd('c', 'запись'),
            ],
            context: ctx(),
            result: () => null,
        });

        const done = await jobs.whenDone(state.id);
        expect(done.progress).toEqual({ phase: 'запись', done: 0, total: undefined, counters: { ok: 3 } });
    });

    it('list по виду, новые первыми; get по id; чужой id → null', async () => {
        const a = jobs.run({ kind: 'x', params: { n: 1 }, commands: [cmd('a')], context: ctx(), result: () => 1 });
        const b = jobs.run({ kind: 'y', params: { n: 2 }, commands: [cmd('b')], context: ctx(), result: () => 2 });
        await Promise.all([jobs.whenDone(a.id), jobs.whenDone(b.id)]);

        expect(jobs.list('x').map((s) => s.id)).toEqual([a.id]);
        expect(
            jobs
                .list()
                .map((s) => s.kind)
                .sort(),
        ).toEqual(['x', 'y']);
        expect(jobs.get(b.id)?.result).toBe(2);
        expect(jobs.get('nope')).toBeNull();
    });

    it('команда поставила stopChain → failed с фазой, следующая команда не идёт, result нет', async () => {
        const state = jobs.run({
            kind: 'k',
            params: {},
            commands: [
                cmd('stop', 'валидация', async (c) => {
                    c.stopChain = true;
                }),
                cmd('never'),
            ],
            context: ctx(),
            result: (c) => c.log,
        });

        const done = await jobs.whenDone(state.id);
        expect(done.status).toBe('failed');
        expect(done.error).toContain('валидация');
        expect(done.result).toBeUndefined();
        expect(done.progress as any).toEqual(expect.objectContaining({ phase: 'валидация' }));
    });

    it('cancel: сразу failed «отменена», цепочке поставлен stopChain, вид свободен для нового запуска', async () => {
        const g = gate();
        const c = ctx();
        const mk = () =>
            jobs.run({
                kind: 'k',
                params: { m: 1 },
                commands: [cmd('w', 'ж', () => g.opened), cmd('never')],
                context: c,
                result: (x) => x.log,
            });

        const a = mk();
        const cancelled = jobs.cancel(a.id);
        expect(cancelled.status).toBe('failed');
        expect(cancelled.error).toBe('отменена');
        expect(cancelled.finishedAt).toBeDefined();
        expect(c.stopChain).toBe(true);
        expect((await jobs.whenDone(a.id)).status).toBe('failed');

        const again = mk();
        expect(again.id).not.toBe(a.id);

        // цепочка доработала после отмены — статус не перезаписан
        g.release();
        await new Promise((r) => setImmediate(r));
        expect(jobs.get(a.id).status).toBe('failed');
        expect(jobs.get(a.id).result).toBeUndefined();
        expect(c.log).toEqual(['w', 'w']); // never не пошла ни в одной

        expect(jobs.cancel('nope')).toBeNull();
    });

    it('cancel завершённой задачи ничего не меняет', async () => {
        const a = jobs.run({ kind: 'k', params: {}, commands: [cmd('a')], context: ctx(), result: () => 1 });
        const done = await jobs.whenDone(a.id);
        const after = jobs.cancel(a.id);
        expect(after.status).toBe('done');
        expect(after.result).toBe(1);
        expect(after.finishedAt).toBe(done.finishedAt);
    });

    it('таймаут: зависшая задача уходит в failed, stopChain выставлен, та же задача запускается заново', async () => {
        const g = gate();
        const c = ctx();
        const mk = () =>
            jobs.run({
                kind: 'k',
                params: { t: 1 },
                timeoutMs: 20,
                commands: [cmd('hang', 'ж', () => g.opened)],
                context: c,
                result: () => 1,
            });

        const a = mk();
        const done = await jobs.whenDone(a.id);
        expect(done.status).toBe('failed');
        expect(done.error).toContain('зависшая');
        expect(c.stopChain).toBe(true);
        expect(mk().id).not.toBe(a.id);
        g.release();
    });

    it('идемпотентность не зависит от порядка ключей params', async () => {
        const g = gate();
        const a = jobs.run({
            kind: 'k',
            params: { market: 'wb', all: true },
            commands: [cmd('w', 'ж', () => g.opened)],
            context: ctx(),
            result: () => 1,
        });
        const same = jobs.run({
            kind: 'k',
            params: { all: true, market: 'wb' },
            commands: [cmd('w')],
            context: ctx(),
            result: () => 1,
        });
        expect(same.id).toBe(a.id);
        g.release();
        await jobs.whenDone(a.id);
    });

    it('whenDone по неизвестному id — ошибка, а не undefined', async () => {
        await expect(jobs.whenDone('nope')).rejects.toThrow('nope');
    });

    it('завершённые старше часа подчищаются при обращении', async () => {
        const a = jobs.run({ kind: 'x', params: {}, commands: [cmd('a')], context: ctx(), result: () => 1 });
        await jobs.whenDone(a.id);
        expect(jobs.get(a.id)).not.toBeNull();

        const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(a.finishedAt) + 61 * 60 * 1000);
        expect(jobs.get(a.id)).toBeNull();
        expect(jobs.list()).toEqual([]);
        spy.mockRestore();
    });
});
