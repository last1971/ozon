import { reactive } from 'vue';
import axios, { clientId } from '@/axios.config';
import type { JobState } from '@/contracts/job.state';

const POLL_MS = 2000;

/** Состояние одного вида задач; общее на все компоненты (как snackbarState в useInfoSnackbar). */
interface JobBox<R> {
    job: JobState<R> | null; // моя текущая (или последняя) задача
    others: JobState[]; // остальные запуски вида: чужие и мои прошлые
    error: string;
    timer: ReturnType<typeof setInterval> | null;
}

const boxes = new Map<string, JobBox<unknown>>();

function storageKey(kind: string) {
    return `job:${kind}`;
}

/**
 * Фоновая задача вида kind: старт, опрос GET /api/job/:id раз в 2 с пока running, подхват после F5
 * (id в localStorage, иначе своя по clientId из списка вида). Следующая длинная задача берёт тот же composable.
 */
export function useJob<R = unknown>(kind: string) {
    if (!boxes.has(kind)) {
        boxes.set(kind, reactive({ job: null, others: [], error: '', timer: null }) as JobBox<unknown>);
    }
    const box = boxes.get(kind) as JobBox<R>;

    const remember = (id: string | null) => {
        try {
            id ? localStorage.setItem(storageKey(kind), id) : localStorage.removeItem(storageKey(kind));
        } catch {}
    };

    const stopPolling = () => {
        if (box.timer) clearInterval(box.timer);
        box.timer = null;
    };

    /** Один опрос: моя задача по id (404 → задача пропала, например после рестарта) + список вида. */
    const refresh = async () => {
        try {
            const list = await axios.get<JobState[]>('/api/job', { params: { kind } });
            const me = clientId();
            if (box.job) {
                try {
                    const res = await axios.get<JobState<R>>(`/api/job/${box.job.id}`);
                    box.job = res.data;
                } catch (e: any) {
                    if (e.response?.status === 404) {
                        box.error = 'задача не найдена — сервер перезапущен или прошло больше часа; запусти заново';
                        box.job = null;
                        remember(null);
                    } else {
                        box.error = e.response?.data?.message || e.message;
                    }
                }
            }
            box.others = list.data.filter((j) => j.id !== box.job?.id);
            // своя задача без сохранённого id (другая вкладка, чищенный localStorage) — подхватить
            if (!box.job && me) {
                const mine = list.data.find((j) => j.clientId === me && j.status === 'running');
                if (mine) {
                    box.job = mine as JobState<R>;
                    remember(mine.id);
                }
            }
        } catch (e: any) {
            box.error = e.response?.data?.message || e.message;
        }
        if (box.job?.status !== 'running') stopPolling();
    };

    const startPolling = () => {
        if (box.timer) return;
        box.timer = setInterval(refresh, POLL_MS);
    };

    /** Запустить: starter делает POST и возвращает состояние задачи. */
    const start = async (starter: () => Promise<JobState<R>>) => {
        box.error = '';
        try {
            box.job = await starter();
            remember(box.job.id);
            startPolling();
        } catch (e: any) {
            box.error = e.response?.data?.message || e.message;
        }
    };

    /** При открытии вкладки: подхватить задачу из localStorage или свою идущую из списка. */
    const attach = async () => {
        if (!box.job) {
            let saved: string | null = null;
            try {
                saved = localStorage.getItem(storageKey(kind));
            } catch {}
            if (saved) box.job = { id: saved, status: 'running' } as JobState<R>; // refresh заменит настоящим состоянием
        }
        await refresh();
        if (box.job?.status === 'running') startPolling();
    };

    const clear = () => {
        stopPolling();
        box.job = null;
        box.error = '';
        remember(null);
    };

    return { box, start, attach, refresh, clear };
}
