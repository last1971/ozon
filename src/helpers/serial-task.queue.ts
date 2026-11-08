import { AsyncLocalStorage, AsyncResource } from 'async_hooks';

export interface SerialTaskOwner {
    id: string;
    kind: string;
}
export interface SerialTaskOptions {
    owner?: SerialTaskOwner;
    priority?: 'manual' | 'background';
    onWaiting?: (waiting: boolean, owner?: SerialTaskOwner) => void;
}
interface PendingTask {
    priority: 'manual' | 'background';
    start: () => void;
    waiting: (owner?: SerialTaskOwner) => void;
    owner?: SerialTaskOwner;
}
interface QueueState {
    running: boolean;
    owner?: SerialTaskOwner;
    manualStreak: number;
    pending: PendingTask[];
}

/** Одна законченная операция по ключу. После трёх ручных операций даём пройти ожидающему фону. */
export class SerialTaskQueue {
    private readonly queues = new Map<string, QueueState>();
    private readonly active = new AsyncLocalStorage<Map<string, { active: boolean }>>();

    state(key: string) {
        const q = this.queues.get(key);
        return {
            running: q?.running ?? false,
            manual: q?.pending.filter((p) => p.priority === 'manual').length ?? 0,
            background: q?.pending.filter((p) => p.priority === 'background').length ?? 0,
        };
    }
    run<T>(key: string | undefined, operation: () => Promise<T>, options: SerialTaskOptions = {}): Promise<T> {
        if (!key || this.active.getStore()?.get(key)?.active) return operation();
        const q = this.queues.get(key) ?? { running: false, manualStreak: 0, pending: [] };
        this.queues.set(key, q);
        const held = new Map(this.active.getStore());
        // Восстанавливаем весь контекст автора операции, а не контекст завершившегося соседа.
        const invoke = AsyncResource.bind(() => this.active.run(held, operation));
        const notify = AsyncResource.bind((waiting: boolean, owner?: SerialTaskOwner) => {
            try {
                options.onWaiting?.(waiting, owner);
            } catch {
                /* Наблюдатель не управляет записью. */
            }
        });
        return new Promise<T>((resolve, reject) => {
            q.pending.push({
                priority: options.priority ?? 'background',
                owner: options.owner,
                waiting: (owner) => notify(true, owner),
                start: () => {
                    notify(false);
                    const token = { active: true };
                    held.set(key, token);
                    Promise.resolve()
                        .then(invoke)
                        .then(resolve, reject)
                        .finally(() => {
                            token.active = false;
                            q.running = false;
                            this.drain(key, q);
                        });
                },
            });
            if (q.running) notify(true, q.owner);
            this.drain(key, q);
        });
    }
    private drain(key: string, q: QueueState) {
        if (q.running) return;
        if (!q.pending.length) {
            this.queues.delete(key);
            return;
        }
        const manual = q.pending.findIndex((p) => p.priority === 'manual');
        const background = q.pending.findIndex((p) => p.priority === 'background');
        const index = manual >= 0 && (background < 0 || q.manualStreak < 3) ? manual : background;
        const [next] = q.pending.splice(index, 1);
        q.manualStreak = next.priority === 'manual' ? q.manualStreak + 1 : 0;
        q.running = true;
        q.owner = next.owner;
        next.start();
        q.pending.forEach((task) => task.waiting(q.owner));
    }
}
