import { CronTime } from 'cron';
import { cronConfig } from './cron.setup';

describe('интервал проверок цен', () => {
    it.each([
        ['ozonPromoSweepMin', 10 * 60 * 1000],
        ['wbHoldMinPrices', 60 * 60 * 1000],
    ])('%s в production запускается с интервалом %d мс', (name, interval) => {
        const setup = cronConfig[name].production;
        expect(typeof setup).toBe('object');
        if (typeof setup === 'boolean') throw new Error('Нет расписания');
        expect(setup.enabled).toBe(true);
        const next = new CronTime(setup.settings.time).sendAt(3);
        expect(next[1].toMillis() - next[0].toMillis()).toBe(interval);
        expect(next[2].toMillis() - next[1].toMillis()).toBe(interval);
        expect(cronConfig[name].development).toBe(false);
    });
});
