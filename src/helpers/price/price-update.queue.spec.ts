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

it('ручная операция проходит между товарами фона; очередь не допускает параллельную запись', async () => {
    const queue = new PriceUpdateQueue(),
        block = gate(),
        order: string[] = [];
    const first = queue.run(
        'ozon',
        async () => {
            order.push('first');
            await block.wait;
        },
        { priority: 'background' },
    );
    await new Promise(setImmediate);
    const background = queue.run(
        'ozon',
        async () => {
            order.push('next');
        },
        { priority: 'background' },
    );
    const manual = queue.run(
        'ozon',
        async () => {
            order.push('manual');
        },
        { priority: 'manual' },
    );
    expect(queue.state('ozon')).toMatchObject({ running: true, manual: 1, background: 1 });
    block.open();
    await Promise.all([first, background, manual]);
    expect(order).toEqual(['first', 'manual', 'next']);
});
it('непрерывные ручные запросы не замораживают фон', async () => {
    const queue = new PriceUpdateQueue(),
        block = gate(),
        order: string[] = [];
    const first = queue.run('ozon', () => block.wait);
    await new Promise(setImmediate);
    const background = queue.run(
        'ozon',
        async () => {
            order.push('background');
        },
        { priority: 'background' },
    );
    const manual = Array.from({ length: 8 }, (_, i) =>
        queue.run(
            'ozon',
            async () => {
                order.push(String(i));
            },
            { priority: 'manual' },
        ),
    );
    block.open();
    await Promise.all([first, background, ...manual]);
    expect(order.indexOf('background')).toBeGreaterThan(0);
    expect(order.indexOf('background')).toBeLessThan(8);
});
it('устаревший снимок фасовки отклоняется; другая фасовка остаётся актуальной', async () => {
    const queue = new PriceUpdateQueue();
    const one = queue.capture('ozon', ['123']),
        ten = queue.capture('ozon', ['123-10']);
    await queue.run('ozon', async () => queue.changed('ozon', ['123-1']));
    expect(() => queue.assertCurrent(one)).toThrow('устарел');
    expect(() => queue.assertCurrent(ten)).not.toThrow();
    queue.inputsChanged({ service: 'OZON', codes: ['123'] });
    expect(() => queue.assertCurrent(ten)).toThrow('устарел');
});

it('ожидающая операция и её уведомления сохраняют контекст своего автора', async () => {
    const { AsyncLocalStorage } = await import('async_hooks');
    const context = new AsyncLocalStorage<string>(),
        queue = new PriceUpdateQueue(),
        block = gate();
    const first = context.run('first', () => queue.run('ozon', () => block.wait));
    await new Promise(setImmediate);
    const seen: (string | undefined)[] = [];
    const second = context.run('second', () =>
        queue.run(
            'ozon',
            async () => {
                seen.push(context.getStore());
            },
            { onWaiting: () => seen.push(context.getStore()) },
        ),
    );
    block.open();
    await Promise.all([first, second]);
    expect(seen).toEqual(['second', 'second', 'second']);
});
