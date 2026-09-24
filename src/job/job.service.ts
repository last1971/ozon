import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { ICommandAsync } from '../interfaces/i.command.acync';
import { IJobCommand, IJobContext } from '../interfaces/i.job.context';
import { JobStateDto } from './job.state.dto';

export interface JobRunOptions<T extends IJobContext, R> {
    kind: string;
    params: Record<string, unknown>;
    clientId?: string;
    commands: IJobCommand<T>[];
    context: T;
    /** Что из контекста считать результатом задачи */
    result: (context: T) => R;
}

/** Сколько живёт завершённая задача, пока её не подчистят */
const FINISHED_TTL_MS = 60 * 60 * 1000;

/**
 * Исполнитель фоновых задач: цепочка команд запускается, не дожидаясь, состояние видно по id.
 * Про ТН ВЭД и прочие задачи не знает. Фаза прогресса = команда с полем phase.
 * Идемпотентный старт: та же задача (kind + params) уже running → возвращается она, а не вторая.
 * Состояния в памяти процесса; завершённые старше часа подчищаются лениво при обращении.
 */
@Injectable()
export class JobService {
    private readonly logger = new Logger(JobService.name);
    private readonly states = new Map<string, JobStateDto>();
    private readonly promises = new Map<string, Promise<JobStateDto>>();

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
        this.states.set(state.id, state);
        this.logger.log(`[job] start ${state.kind} ${state.id} ${JSON.stringify(state.params)}`);

        const chain = new CommandChainAsync<T>(opts.commands.map((c) => this.withPhase(c, state)));
        // .catch обязателен: unhandled rejection роняет процесс, pm2 рестартует и стирает все задачи
        const promise = chain
            .execute(opts.context)
            .then((ctx) => {
                state.result = opts.result(ctx);
                state.status = 'done';
            })
            .catch((e) => {
                state.error = e?.message ?? String(e);
                state.status = 'failed';
                this.logger.error(`[job] failed ${state.kind} ${state.id}: ${state.error}`);
            })
            .then(() => {
                state.finishedAt = new Date().toISOString();
                this.logger.log(`[job] ${state.status} ${state.kind} ${state.id}`);
                return state;
            });
        this.promises.set(state.id, promise);
        return state;
    }

    get(id: string): JobStateDto | null {
        this.cleanup();
        return this.states.get(id) ?? null;
    }

    list(kind?: string): JobStateDto[] {
        this.cleanup();
        return [...this.states.values()]
            .filter((s) => !kind || s.kind === kind)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }

    /** Дождаться завершения — для синхронных вызовов и тестов. */
    whenDone(id: string): Promise<JobStateDto> {
        return this.promises.get(id) ?? Promise.resolve(this.states.get(id));
    }

    private findRunning(kind: string, params: Record<string, unknown>): JobStateDto | null {
        const key = JSON.stringify(params);
        for (const s of this.states.values()) {
            if (s.status === 'running' && s.kind === kind && JSON.stringify(s.params) === key) return s;
        }
        return null;
    }

    /** Обёртка команды: перед выполнением пишет её фазу в прогресс задачи. */
    private withPhase<T extends IJobContext>(command: IJobCommand<T>, state: JobStateDto): ICommandAsync<T> {
        return {
            execute: async (ctx: T) => {
                if (command.phase) {
                    ctx.progress.phase = command.phase;
                    ctx.progress.done = 0;
                    ctx.progress.total = undefined;
                }
                return command.execute(ctx);
            },
        };
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
