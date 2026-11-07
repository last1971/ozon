import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronTime } from 'cron';
import { LossScheduleService } from './loss-schedule.service';
import { OzonReturnService } from '../trade2006.accrual/ozon.return.service';
import { cronConfig } from '../cron.setup.provider/cron.setup';
import { PRICING_WRITE_CRONS } from '../helpers/price/pricing-review-mode';
import { JobService } from '../job/job.service';
import { emptyProgress } from '../interfaces/i.job.context';
const setup = (services = ['OZON', 'WB', 'YANDEX'], environment = 'production') => {
    const config = { get: (key: string) => (key === 'NODE_ENV' ? environment : undefined) } as ConfigService;
    const markets = {
        list: jest.fn(() => services.map((service) => ({ service }))),
        start: jest.fn((service) => ({ id: 'daily-' + service })),
    };
    const prices = { start: jest.fn((service) => ({ id: 'price-' + service })) };
    const queue = { pending: jest.fn().mockResolvedValue([{ extId: 'pending' }]) };
    const jobs = {
        list: jest.fn().mockReturnValue([]),
        whenDone: jest.fn(async (id) => ({ id, status: 'done', result: { rows: 12, completed: 1, pending: [] } })),
    };
    return {
        markets,
        prices,
        queue,
        jobs,
        service: new LossScheduleService(config, markets as any, prices as any, queue as any, jobs as any),
    };
};
const oldMode = process.env.PRICING_REVIEW_MODE;
beforeEach(() => {
    process.env.PRICING_REVIEW_MODE = 'false';
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
});
afterEach(() => {
    oldMode === undefined ? delete process.env.PRICING_REVIEW_MODE : (process.env.PRICING_REVIEW_MODE = oldMode);
    jest.restoreAllMocks();
});
describe('Ежедневная статистика существующими цепочками', () => {
    it('ВБ и Яндекс вызывают тот же start, что ручной запуск, и ожидают результат', async () => {
        const s = setup();
        await s.service.dailyWb();
        await s.service.dailyYandex();
        expect(s.markets.start.mock.calls).toEqual([
            ['WB', 'cron'],
            ['YANDEX', 'cron'],
        ]);
        expect(s.jobs.whenDone.mock.calls).toEqual([['daily-WB'], ['daily-YANDEX']]);
        expect(s.prices.start).not.toHaveBeenCalled();
    });
    it.each(['development', 'test', undefined])('не запускает запись в окружении %p', async (environment) => {
        const s = setup(['WB', 'YANDEX'], environment ?? '');
        await s.service.dailyWb();
        await s.service.dailyYandex();
        await s.service.retryPrices();
        expect(s.markets.start).not.toHaveBeenCalled();
        expect(s.prices.start).not.toHaveBeenCalled();
        expect(s.queue.pending).not.toHaveBeenCalled();
    });
    it('отключённые площадки не запускает', async () => {
        const s = setup(['OZON']);
        await s.service.dailyWb();
        await s.service.dailyYandex();
        expect(s.markets.start).not.toHaveBeenCalled();
    });
    it('ошибка job/API не теряется и не становится успехом', async () => {
        const s = setup();
        s.jobs.whenDone.mockResolvedValueOnce({ id: 'daily-WB', status: 'failed', error: 'API offline' } as any);
        await expect(s.service.dailyWb()).resolves.toBeUndefined();
        expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('API offline'));
        expect(Logger.prototype.log).not.toHaveBeenCalled();
    });
    it('суточный и ручной запуск объединяет существующий JobService', async () => {
        const jobs = new JobService();
        let release: () => void;
        let commands = 0;
        const start = () =>
            jobs.run({
                kind: 'loss-recalculate:wb',
                params: { from: '2026-08-09', to: '2026-11-07' },
                context: { progress: emptyProgress() },
                commands: [
                    {
                        execute: async (ctx) => {
                            commands++;
                            await new Promise<void>((resolve) => {
                                release = resolve;
                            });
                            return ctx;
                        },
                    },
                ],
                result: () => ({ rows: 1 }),
            });
        const manual = start();
        const s = setup(['WB']);
        const service = new LossScheduleService(
            { get: () => 'production' } as unknown as ConfigService,
            { list: () => [{ service: 'WB' }], start } as any,
            s.prices as any,
            s.queue as any,
            jobs,
        );
        const daily = service.dailyWb();
        for (let i = 0; i < 100 && !release; i++) await new Promise<void>((resolve) => setImmediate(resolve));
        expect(release).toBeDefined();
        expect(jobs.list('loss-recalculate:wb')).toHaveLength(1);
        release();
        await daily;
        await jobs.whenDone(manual.id);
        expect(commands).toBe(1);
    });
});
describe('Периодический повтор очереди', () => {
    it('берёт только Ozon и ВБ с незавершёнными заданиями', async () => {
        const s = setup();
        s.queue.pending.mockImplementation(async (service) => (service === 'WB' ? [] : [{}]));
        await s.service.retryPrices();
        expect(s.prices.start.mock.calls).toEqual([['OZON', 'cron']]);
        expect(s.queue.pending.mock.calls).toEqual([['OZON'], ['WB']]);
    });
    it('не создаёт второй проход, пока первый выполняется', async () => {
        const s = setup(['WB']);
        s.jobs.list.mockReturnValue([{ status: 'running' }]);
        await s.service.retryPrices();
        expect(s.queue.pending).not.toHaveBeenCalled();
        expect(s.prices.start).not.toHaveBeenCalled();
    });
    it('ошибка одной площадки не мешает другой', async () => {
        const s = setup();
        s.queue.pending.mockImplementation(async (service) => {
            if (service === 'OZON') throw new Error('DB offline');
            return [{}];
        });
        await s.service.retryPrices();
        expect(s.prices.start).toHaveBeenCalledWith('WB', 'cron');
        expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('DB offline'));
    });
    it('режим проверки не запускает отправку, статистика остаётся доступной', async () => {
        process.env.PRICING_REVIEW_MODE = 'true';
        const s = setup();
        await s.service.retryPrices();
        await s.service.dailyWb();
        expect(s.prices.start).not.toHaveBeenCalled();
        expect(s.queue.pending).not.toHaveBeenCalled();
        expect(s.markets.start).toHaveBeenCalledWith('WB', 'cron');
        expect(PRICING_WRITE_CRONS.has('marketplaceLossPriceRetry')).toBe(true);
    });
    it('длительная задача одной площадки не блокирует запуск другой', async () => {
        const s = setup();
        let release: () => void;
        s.jobs.whenDone.mockImplementation(async (id) => {
            if (id === 'price-OZON')
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            return { id, status: 'done', result: { completed: 1, pending: [] } } as any;
        });
        const running = s.service.retryPrices();
        for (let i = 0; i < 100 && !release; i++) await new Promise<void>((resolve) => setImmediate(resolve));
        expect(release).toBeDefined();
        expect(s.prices.start).toHaveBeenCalledWith('WB', 'cron');
        release();
        await running;
    });
});
describe('Регистрация времени и сохранение прежнего расписания Ozon', () => {
    it.each([
        [LossScheduleService.prototype.dailyWb, 'wbLossStats', '0 8 6 * * *', '2026-11-07T06:08:00.000+03:00'],
        [LossScheduleService.prototype.dailyYandex, 'yandexLossStats', '0 38 6 * * *', '2026-11-07T06:38:00.000+03:00'],
        [OzonReturnService.prototype.daily, 'ozonReturnPerc', '0 38 5 * * *', '2026-11-07T05:38:00.000+03:00'],
    ])('суточный запуск %s задан по Москве и включён только в production', (method, name, time, expected) => {
        const meta = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', method);
        expect(meta).toMatchObject({ name, cronTime: time, timeZone: 'Europe/Moscow' });
        expect(cronConfig[String(name)]).toEqual({ production: true, development: false });
        expect(
            new CronTime(String(time), 'Europe/Moscow')
                .getNextDateFrom(new Date('2026-11-07T00:00:00Z'), meta.timeZone)
                .toISO(),
        ).toBe(expected);
    });
    it('повтор каждые 10 минут не подменяется часовым поясом сервера', () => {
        const meta = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', LossScheduleService.prototype.retryPrices);
        expect(meta).toMatchObject({
            name: 'marketplaceLossPriceRetry',
            cronTime: '0 6/10 * * * *',
            timeZone: 'Europe/Moscow',
        });
        expect(cronConfig.marketplaceLossPriceRetry).toEqual({ production: true, development: false });
        const first = new CronTime(meta.cronTime, meta.timeZone).getNextDateFrom(
            new Date('2026-11-07T00:00:00Z'),
            meta.timeZone,
        );
        const second = new CronTime(meta.cronTime, meta.timeZone).getNextDateFrom(first.toJSDate(), meta.timeZone);
        expect(first.toISO()).toBe('2026-11-07T03:06:00.000+03:00');
        expect(second.toMillis() - first.toMillis()).toBe(10 * 60_000);
    });
});
