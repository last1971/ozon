import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from '@/axios.config';
import { useJob } from '../useJob';
vi.mock('@/axios.config', () => ({ default: { get: vi.fn() }, clientId: () => 'browser' }));
afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    localStorage.clear();
});
describe('Общий прогресс массовых обновлений', () => {
    it('подхватывает задачу из Swagger/крона, опрашивает её и показывает итог', async () => {
        vi.useFakeTimers();
        let state: any = {
            id: 'bulk-1',
            kind: 'bulk-test',
            clientId: 'cron',
            status: 'running',
            progress: { percent: 10, done: 1, total: 10, counters: {} },
        };
        vi.mocked(axios.get).mockImplementation(async (url) => ({ data: url === '/api/job' ? [state] : state }));
        const job = useJob('bulk-test', { followLatest: true });
        await job.attach();
        expect(job.box.job?.id).toBe('bulk-1');
        state = { ...state, status: 'done', result: { unchanged: 22 }, progress: { ...state.progress, percent: 100 } };
        await vi.advanceTimersByTimeAsync(2000);
        expect(job.box.job?.status).toBe('done');
        expect(job.box.job?.result).toEqual({ unchanged: 22 });
        const count = vi.mocked(axios.get).mock.calls.length;
        await vi.advanceTimersByTimeAsync(60000);
        expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(count);
        job.clear();
    });
    it('старые экраны не подхватывают чужую задачу без followLatest', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: [{ id: 'foreign', clientId: 'cron', status: 'running' }] });
        const job = useJob('old-kind');
        await job.attach();
        expect(job.box.job).toBeNull();
        expect(job.box.others).toHaveLength(1);
        job.clear();
    });
});

it('запоздавший ответ прежнего опроса не заменяет новую отправку', async () => {
    const job = useJob('race');
    job.clear();
    let release: (value: any) => void;
    vi.mocked(axios.get).mockImplementation(() => new Promise((r) => (release = r)));
    const oldRead = job.refresh();
    const sending: any = {
        id: 'new-send',
        kind: 'race',
        status: 'running',
        progress: { percent: 0, done: 0, total: 1, counters: {} },
    };
    await job.start(async () => sending);
    release!({ data: [{ id: 'old', status: 'done' }] });
    await oldRead;
    expect(job.box.job?.id).toBe('new-send');
    job.clear();
});
it('сохраняет прежний результат на время нового расчёта', async () => {
    const job = useJob('previous');
    job.clear();
    await job.start(async () => ({
        id: 'old',
        kind: 'previous',
        status: 'done',
        params: {},
        startedAt: '',
        progress: { done: 1, total: 1, percent: 100, counters: {} },
        result: { price: 260 },
    }));
    await job.start(async () => ({
        id: 'new',
        kind: 'previous',
        status: 'running',
        params: {},
        startedAt: '',
        progress: { done: 0, total: 1, percent: 0, counters: {} },
    }));
    expect(job.box.lastResult).toEqual({ price: 260 });
    expect(job.box.job?.status).toBe('running');
    job.clear();
});
