import { withJobExecution } from './job.execution';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { ICommandAsync } from '../interfaces/i.command.acync';
import { IJobCommand, IJobContext } from '../interfaces/i.job.context';
import { JobStateDto } from './job.state.dto';

export interface JobRunOptions<T extends IJobContext, R> {
    /** Обёртка всей цепочки, например очередь записи кабинета; ошибки обрабатывает JobService. */
    execute?: (run: () => Promise<T>) => Promise<T>;
    kind: string;
    params: Record<string, unknown>;
    clientId?: string;
    commands: IJobCommand<T>[];
    /** Не меняет контракт старых задач, пока замеры не включены явно. */
    measure?: boolean;
    context: T;
    /** Что из контекста считать результатом задачи */
    result: (context: T) => R;
    /** Сколько задаче можно идти; дольше — считается зависшей и уходит в failed. По умолчанию час. */
    timeoutMs?: number;
    /** Освободить ресурсы после остановки цепочки, до завершения задачи (например, откатить транзакцию). */
    cleanup?: (context: T) => Promise<void>;
    /** Короткий необратимый участок (COMMIT): отмена уже не может обещать откат. */
    canCancel?: (context: T) => boolean;
}

/** Сколько живёт завершённая задача, пока её не подчистят */
const FINISHED_TTL_MS = 60 * 60 * 1000;
/** Сколько задаче можно идти, прежде чем считать её зависшей */
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

/** Идущая задача: контекст (чтобы поставить stopChain) и способ завершить её снаружи */
interface ActiveJob {
    context: IJobContext;
    cancel: (error: string) => void;
}

/**
 * Ключ params, не зависящий от порядка полей: { a, b } и { b, a } — одна задача.
 * JSON.stringify с массивом-replacer не подходит: он режет ключи вложенных объектов.
 */
const paramsKey = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(paramsKey).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${paramsKey(o[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v);
};

/**
 * Исполнитель фоновых задач: цепочка команд запускается, не дожидаясь, состояние видно по id.
 * Про ТН ВЭД и прочие задачи не знает. Фаза прогресса = команда с полем phase.
 * Идемпотентный старт: та же задача (kind + params) уже running → возвращается она, а не вторая.
 * Задача завершается ровно один раз — кто первый (цепочка, таймаут или cancel), тот и ставит статус;
 * остановка цепочки командой (stopChain) — это failed, а не done: работа не доделана.
 * Состояния в памяти процесса; завершённые старше часа подчищаются лениво при обращении.
 */
@Injectable()
export class JobService {
    private readonly logger = new Logger(JobService.name);
    private readonly states = new Map<string, JobStateDto>();
    private readonly promises = new Map<string, Promise<JobStateDto>>();
    private readonly active = new Map<string, ActiveJob>();

    run<T extends IJobContext, R>(opts: JobRunOptions<T, R>): JobStateDto {
        this.cleanup();
        const same = this.findRunning(opts.kind, opts.params);
        if (same) return same;

        const state: JobStateDto = {
            id: randomUUID(),
            kind: opts.kind,
            params: opts.params,
            clientId: opts.clientId,
            status: 'running',
            progress: opts.context.progress,
            startedAt: new Date().toISOString(),
        };
        if (opts.measure) state.progress.metrics = { phaseMs: {}, operations: {} };
        const weighted = this.weightedProgress(opts.commands, state);
        this.states.set(state.id, state);
        this.logger.log(`[job] start ${state.kind} ${state.id} ${JSON.stringify(state.params)}`);

        const chain = new CommandChainAsync<T>(opts.commands.map((c, i) => this.withPhase(c, weighted, i)));
        const promise = new Promise<JobStateDto>((resolve) => {
            const finish = (apply: () => void) => {
                if (state.status !== 'running') return; // уже завершили другим путём
                clearTimeout(timer);
                this.active.delete(state.id);
                apply();
                state.finishedAt = new Date().toISOString();
                this.logger.log(
                    `[job] ${state.status} ${state.kind} ${state.id}${state.error ? `: ${state.error}` : ''}`,
                );
                resolve(state);
            };
            const fail = (error: string) =>
                finish(() => {
                    void state.progress.percent;
                    state.status = 'failed';
                    state.error = error;
                    for (const activity of Object.values(state.progress.activities ?? {})) {
                        if (activity.state === 'running' || activity.state === 'waiting') {
                            activity.state = 'failed';
                            activity.error = error;
                            delete activity.waitingFor;
                        }
                    }
                });

            let cancellation: string | undefined;
            const cancel = (error: string) => {
                if (opts.canCancel?.(opts.context) === false) return;
                opts.context.stopChain = true;
                cancellation = error;
                // Старые задачи завершаются сразу; задачи с ресурсами сначала дожидаются их освобождения.
                if (!opts.cleanup) fail(error);
            };
            const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
            const timer = setTimeout(() => {
                cancel(`не уложилась в ${Math.round(timeoutMs / 60000)} мин — остановлена как зависшая`);
            }, timeoutMs);
            timer.unref?.();
            this.active.set(state.id, { context: opts.context, cancel });
            let cleaned = false;
            const cleanup = async (ctx: T) => {
                if (cleaned) return;
                cleaned = true;
                await opts.cleanup?.(ctx);
            };

            // .catch обязателен: unhandled rejection роняет процесс, pm2 рестартует и стирает все задачи
            withJobExecution(state, () =>
                opts.execute ? opts.execute(() => chain.execute(opts.context)) : chain.execute(opts.context),
            )
                .then(async (ctx) => {
                    if (opts.cleanup) await cleanup(ctx);
                    if (ctx.stopChain)
                        return fail(cancellation ?? `остановлена командой на фазе «${ctx.progress.phase ?? '?'}»`);
                    finish(() => {
                        state.result = opts.result(ctx);
                        state.status = 'done';
                    });
                })
                .catch(async (e) => {
                    try {
                        if (opts.cleanup) await cleanup(opts.context);
                    } catch (cleanupError) {
                        e = new Error(
                            `${e?.message ?? e}; освобождение ресурсов: ${cleanupError?.message ?? cleanupError}`,
                        );
                    }
                    this.logger.error(`[job] failed ${state.kind} ${state.id}`, e?.stack ?? String(e));
                    fail(cancellation ?? e?.message ?? String(e));
                });
        });
        this.promises.set(state.id, promise);
        return state;
    }

    get(id: string): JobStateDto | null {
        this.cleanup();
        const state = this.states.get(id);
        if (state) this.refreshWaiting(state);
        return state ?? null;
    }

    list(kind?: string): JobStateDto[] {
        this.cleanup();
        return [...this.states.values()]
            .filter((s) => !kind || s.kind === kind)
            .map((s) => {
                this.refreshWaiting(s);
                return s;
            })
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }

    /**
     * Отменить: цепочке ставится stopChain. Старые задачи сразу failed; задачи с cleanup
     * завершаются после остановки текущей команды и освобождения ресурсов. COMMIT может запретить отмену.
     */
    cancel(id: string): JobStateDto | null {
        const state = this.get(id);
        if (!state) return null;
        const job = this.active.get(id);
        if (job) {
            job.cancel('отменена');
        }
        return state;
    }

    /** Дождаться завершения — для синхронных вызовов и тестов. Неизвестный id — ошибка, а не undefined. */
    whenDone(id: string): Promise<JobStateDto> {
        return this.promises.get(id) ?? Promise.reject(new Error(`задача ${id} не найдена`));
    }

    private findRunning(kind: string, params: Record<string, unknown>): JobStateDto | null {
        const key = paramsKey(params);
        for (const s of this.states.values()) {
            if (s.status === 'running' && s.kind === kind && paramsKey(s.params) === key) return s;
        }
        return null;
    }

    /** Обёртка команды: перед выполнением пишет её фазу в прогресс задачи. */
    private withPhase<T extends IJobContext>(
        command: IJobCommand<T>,
        weighted?: { start: (index: number) => void; complete: () => void },
        index = 0,
    ): ICommandAsync<T> {
        return {
            execute: async (ctx: T) => {
                if (command.phase) {
                    ctx.progress.phase = command.phase;
                    ctx.progress.done = 0;
                    ctx.progress.total = undefined;
                }
                delete ctx.progress.activities;
                weighted?.start(index);
                const started = performance.now();
                let result: T;
                try {
                    result = await command.execute(ctx);
                } finally {
                    if (ctx.progress.metrics) {
                        const key = command.phase ?? `phase-${index}`;
                        ctx.progress.metrics.phaseMs[key] =
                            (ctx.progress.metrics.phaseMs[key] ?? 0) + Math.max(0, performance.now() - started);
                    }
                }
                if (!result.stopChain) {
                    for (const activity of Object.values(result.progress.activities ?? {}))
                        if (activity.state === 'running') activity.state = 'done';
                    weighted?.complete();
                }
                return result;
            },
        };
    }

    /** Считается при чтении DTO: команды по-прежнему меняют только done/total. */
    private weightedProgress(commands: IJobCommand<IJobContext>[], state: JobStateDto) {
        if (!commands.some((command) => command.weight !== undefined)) return undefined;
        const weights = commands.map((command) => command.weight ?? 1);
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        if (
            weights.some((weight) => !Number.isFinite(weight) || weight < 0) ||
            !Number.isFinite(totalWeight) ||
            totalWeight <= 0
        )
            throw new Error('Вес фаз должен быть конечным, неотрицательным, с положительной суммой');
        let completed = 0,
            active = 0,
            highest = 0;
        Object.defineProperty(state.progress, 'percent', {
            enumerable: true,
            get: () => {
                if (state.status === 'done') return 100;
                if (state.status === 'failed') return highest;
                const { done, total } = state.progress;
                const fraction =
                    Number.isFinite(done) && Number.isFinite(total) && total > 0
                        ? Math.max(0, Math.min(1, done / total))
                        : 0;
                // 100 означает завершение цепочки; частичные ошибки остаются в её результате.
                highest = Math.max(
                    highest,
                    Math.min(99, Math.floor((100 * (completed + active * fraction)) / totalWeight)),
                );
                return highest;
            },
        });
        return {
            start: (index: number) => {
                active = weights[index];
            },
            complete: () => {
                completed += active;
                active = 0;
                void state.progress.percent;
            },
        };
    }

    private refreshWaiting(state: JobStateDto): void {
        for (const activity of Object.values(state.progress.activities ?? {})) {
            const waiting = activity.waitingFor;
            if (!waiting) continue;
            const owner = this.states.get(waiting.id);
            delete waiting.percent;
            delete waiting.phase;
            delete waiting.done;
            delete waiting.total;
            if (!owner) continue;
            const { percent, phase, done, total } = owner.progress;
            Object.assign(waiting, { ...(percent !== undefined ? { percent } : {}), phase, done, total });
        }
    }

    private cleanup(): void {
        const deadline = Date.now() - FINISHED_TTL_MS;
        for (const [id, s] of this.states) {
            if (s.finishedAt && Date.parse(s.finishedAt) < deadline) {
                this.states.delete(id);
                this.promises.delete(id);
            }
        }
    }
}
