/** Состояние фоновой задачи — как отдаёт GET /api/job/:id (см. src/job/job.state.dto.ts на бэке). */
export interface JobProgress {
    phase?: string;
    done: number;
    total?: number;
    counters: Record<string, number>;
}

export type JobStatus = 'running' | 'done' | 'failed';

export interface JobState<R = unknown> {
    id: string;
    kind: string;
    params: Record<string, unknown>;
    clientId?: string;
    status: JobStatus;
    progress: JobProgress;
    result?: R;
    error?: string;
    startedAt: string;
    finishedAt?: string;
}
