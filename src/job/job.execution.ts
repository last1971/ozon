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

/** Диагностика живёт в существующем JobService и контексте автора, без отдельного хранилища. */
export function addJobMetric(name: string, amount = 1): void {
    const metrics = currentJob()?.progress.metrics;
    if (metrics && Number.isFinite(amount) && amount >= 0)
        metrics.operations[name] = (metrics.operations[name] ?? 0) + amount;
}
export async function measureJobOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
        return await operation();
    } finally {
        addJobMetric(name, Math.max(0, performance.now() - started));
    }
}
