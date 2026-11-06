import { AsyncLocalStorage } from 'async_hooks';

/** Последовательное выполнение задач по ключу. Вложенные шаги операции не ждут сами себя. */
export class SerialTaskQueue {
    private readonly tails = new Map<string, Promise<unknown>>();
    private readonly active = new AsyncLocalStorage<Map<string, { active: boolean }>>();

    run<T>(key: string | undefined, operation: () => Promise<T>): Promise<T> {
        if (!key || this.active.getStore()?.get(key)?.active) return operation();
        const previous = this.tails.get(key) ?? Promise.resolve();
        const held = new Map(this.active.getStore());
        const token = { active: true };
        held.set(key, token);
        const result = previous.catch(() => undefined).then(() => this.active.run(held, operation));
        const tail = result
            .then(
                () => undefined,
                () => undefined,
            )
            .finally(() => {
                token.active = false;
                if (this.tails.get(key) === tail) this.tails.delete(key);
            });
        this.tails.set(key, tail);
        return result;
    }
}
