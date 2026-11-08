import { AsyncLocalStorage } from 'async_hooks';
import type { JobStateDto } from './job.state.dto';
import type { JobActivity } from '../interfaces/i.job.context';

/** Контекст существующего JobService: связывает текущую операцию очереди с её заданием. */
const execution = new AsyncLocalStorage<JobStateDto>();
export const currentJob = () => execution.getStore();
export const withJobExecution = <T>(job: JobStateDto, run: () => Promise<T>) => execution.run(job, run);
export function setJobActivity(
    key: string,
    phase: string,
    state: JobActivity['state'] = 'running',
    error?: string,
): JobActivity | undefined {
    const job = currentJob();
    if (!job || job.status !== 'running') return;
    job.progress.activities ??= {};
    return (job.progress.activities[key] = { phase, state, ...(error ? { error } : {}) });
}
