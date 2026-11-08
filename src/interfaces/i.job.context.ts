import { ICommandAsync } from './i.command.acync';

export interface JobActivity {
    phase: string;
    state: 'running' | 'waiting' | 'done' | 'failed' | 'skipped';
    error?: string;
    waitingFor?: { id: string; kind: string; phase?: string; percent?: number; done?: number; total?: number };
}

/** Ход задачи. Команды двигают done/total/counters сами, фазу пишет исполнитель (JobService). */
export interface JobMetrics {
    /** Время фаз и операций в миллисекундах; вложенные операции не складываются с фазами. */
    phaseMs: Record<string, number>;
    operations: Record<string, number>;
}
export interface JobProgress {
    metrics?: JobMetrics;
    /** Общий процент цепочки; задаёт JobService для команд с весами. */
    percent?: number;
    phase?: string; // на какой команде сейчас: «база», «каталог», «сверка», «запись»…
    done: number; // сколько единиц текущей фазы сделано
    total?: number; // сколько всего в текущей фазе, если известно
    counters: Record<string, number>;
    /** Независимые операции площадок и реальная причина ожидания в общей очереди. */
    activities?: Record<string, JobActivity>; // произвольные счётчики по ходу: ok, toFix, ambiguous…
}

/** То, что должен нести контекст любой фоновой задачи. Контексты задач его расширяют. */
export interface IJobContext {
    progress: JobProgress;
    stopChain?: boolean;
    logger?: { log: (msg: string) => void; error: (msg: string) => void };
}

/** Команда, которая хочет быть фазой прогресса, объявляет её имя. Без phase — фаза не меняется. */
export interface IJobCommand<T extends IJobContext> extends ICommandAsync<T> {
    readonly phase?: string;
    /** Относительный вес фазы. Без весов сохраняется прежний прогресс по фазам. */
    readonly weight?: number;
}

export const emptyProgress = (): JobProgress => ({ done: 0, counters: {} });
