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
