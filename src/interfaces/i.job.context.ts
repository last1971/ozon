import { ICommandAsync } from './i.command.acync';

/** Ход задачи. Команды двигают done/total/counters сами, фазу пишет исполнитель (JobService). */
export interface JobProgress {
    phase?: string; // на какой команде сейчас: «база», «каталог», «сверка», «запись»…
    done: number; // сколько единиц текущей фазы сделано
    total?: number; // сколько всего в текущей фазе, если известно
    counters: Record<string, number>; // произвольные счётчики по ходу: ok, toFix, ambiguous…
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
}

export const emptyProgress = (): JobProgress => ({ done: 0, counters: {} });
