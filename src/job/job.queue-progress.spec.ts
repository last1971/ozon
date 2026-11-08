import { JobService } from './job.service';
import { emptyProgress } from '../interfaces/i.job.context';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
const gate = () => {
    let open: () => void;
    const wait = new Promise<void>((r) => (open = r));
    return { wait, open: () => open() };
};
it('ожидающий job показывает настоящую блокирующую задачу, её общий процент и смену состояния', async () => {
    const jobs = new JobService(),
        block = gate();
    const background = jobs.run({
        kind: 'ozon-promo-sweep',
        params: {},
        context: { progress: emptyProgress() },
        result: () => null,
        commands: [
            {
                phase: 'Изменение акций Ozon',
                weight: 1,
                execute: async (ctx) => {
                    ctx.progress.total = 10;
                    ctx.progress.done = 4;
                    await priceUpdateQueue.run('ozon', () => block.wait);
                    return ctx;
                },
            },
        ],
    });
    const manual = jobs.run({
        kind: 'price-review:1',
        params: {},
        context: { progress: emptyProgress() },
        result: () => null,
        commands: [
            {
                phase: 'Подготовка отправки цен',
                weight: 1,
                execute: async (ctx) => {
                    await priceUpdateQueue.run('ozon', async () => {}, { priority: 'manual' });
                    return ctx;
                },
            },
        ],
    });
    try {
        const progress: any = jobs.get(manual.id).progress;
        expect(progress.percent).toBe(0);
        expect(JSON.parse(JSON.stringify(jobs.get(manual.id))).progress.activities.ozon.waitingFor.percent).toBe(40);
        expect(progress.activities.ozon).toMatchObject({
            state: 'waiting',
            phase: 'Ожидание текущей операции Ozon',
            waitingFor: { id: background.id, kind: 'ozon-promo-sweep', percent: 40, done: 4, total: 10 },
        });
    } finally {
        block.open();
        await Promise.all([jobs.whenDone(background.id), jobs.whenDone(manual.id)]);
    }
    expect((jobs.get(manual.id).progress as any).activities.ozon).toMatchObject({ state: 'done' });
    expect((jobs.get(manual.id).progress as any).activities.ozon.waitingFor).toBeUndefined();
});

it('для операции без job показывает ожидание без выдуманного процента фона', async () => {
    const jobs = new JobService(),
        block = gate();
    const held = priceUpdateQueue.run('wb', () => block.wait);
    const manual = jobs.run({
        kind: 'manual',
        params: {},
        context: { progress: emptyProgress() },
        result: () => null,
        commands: [
            {
                weight: 1,
                execute: async (ctx) => {
                    await priceUpdateQueue.run('wb', async () => {});
                    return ctx;
                },
            },
        ],
    });
    try {
        const activity = (jobs.get(manual.id).progress as any).activities.wb;
        expect(activity.phase).toBe('Ожидание текущей операции ВБ');
        expect(activity.waitingFor).toBeUndefined();
    } finally {
        block.open();
        await held;
        await jobs.whenDone(manual.id);
    }
});
