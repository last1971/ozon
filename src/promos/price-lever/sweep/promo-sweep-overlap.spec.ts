import { JobService } from '../../../job/job.service';
import { PromoSweepService } from './promo-sweep.service';
import { PricingModeController } from '../../../price/pricing-mode.controller';
import { CronJob } from 'cron';
it('следующий cron не создаёт копию ещё работающей полной сверки', async () => {
    const jobs = new JobService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const collect = {
        phase: 'сбор',
        execute: async (ctx) => {
            await gate;
            return ctx;
        },
    };
    const noop = { execute: async (ctx) => ctx };
    const report = {
        execute: async (ctx) => {
            ctx.report = { checked: 0 };
            return ctx;
        },
    };
    const service = new PromoSweepService(
        jobs,
        collect as any,
        noop as any,
        noop as any,
        noop as any,
        report as any,
        noop as any,
    );
    const old = process.env.PRICING_REVIEW_MODE;
    process.env.PRICING_REVIEW_MODE = 'false';
    try {
        service.holdMin();
        service.holdMin();
        const all = jobs.list('ozon-promo-sweep');
        expect(all).toHaveLength(1);
        expect(all[0].status).toBe('running');
        release();
        await jobs.whenDone(all[0].id);
        service.holdMin();
        const next = jobs.list('ozon-promo-sweep');
        expect(next).toHaveLength(2);
        await Promise.all(next.map((job) => jobs.whenDone(job.id)));
    } finally {
        if (old === undefined) delete process.env.PRICING_REVIEW_MODE;
        else process.env.PRICING_REVIEW_MODE = old;
        release();
    }
});
it('диагностика читает фактическое выражение CronJob, не копию из плана', () => {
    const cron = new CronJob('0 9 * * * *', () => {}, null, false, 'Europe/Moscow');
    const result = new PricingModeController({
        getCronJobs: () => new Map([['wbHoldMinPrices', cron]]),
    } as any).status();
    expect(result.crons[0]).toMatchObject({
        name: 'wbHoldMinPrices',
        running: false,
        expression: '0 9 * * * *',
        timeZone: 'Europe/Moscow',
    });
});
