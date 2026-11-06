import { PriceUpdateQueue } from './price-update.queue';
const gate = () => {
    let open: () => void;
    const wait = new Promise<void>((r) => (open = r));
    return { wait, open: () => open() };
};
describe('Очередь обновлений кабинета', () => {
    it('приход ждёт полного ручного пересчёта; другая площадка работает независимо', async () => {
        const queue = new PriceUpdateQueue(),
            block = gate(),
            order: string[] = [];
        const manual = queue.run('ozon', async () => {
            order.push('manual');
            await block.wait;
            order.push('manual-end');
        });
        const incoming = queue.run('ozon', async () => {
            order.push('incoming');
        });
        await queue.run('wb', async () => {
            order.push('wb');
        });
        expect(order).toEqual(['manual', 'wb']);
        block.open();
        await Promise.all([manual, incoming]);
        expect(order).toEqual(['manual', 'wb', 'manual-end', 'incoming']);
    });
    it('вложенные отправки не зависают, ошибка освобождает очередь', async () => {
        const queue = new PriceUpdateQueue();
        await expect(
            queue.run('ozon', () =>
                queue.run('ozon', async () => {
                    throw new Error('fail');
                }),
            ),
        ).rejects.toThrow('fail');
        await expect(queue.run('ozon', async () => 'next')).resolves.toBe('next');
    });
});
