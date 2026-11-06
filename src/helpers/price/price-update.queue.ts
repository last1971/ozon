import { SerialTaskQueue } from '../serial-task.queue';
export { SerialTaskQueue as PriceUpdateQueue } from '../serial-task.queue';
export const priceUpdateQueue = new SerialTaskQueue();

export function SerializePriceUpdate(key: string) {
    return (_target: unknown, _name: string, descriptor: PropertyDescriptor) => {
        const method = descriptor.value;
        descriptor.value = function (...args: unknown[]) {
            return priceUpdateQueue.run(key, () => method.apply(this, args));
        };
    };
}
