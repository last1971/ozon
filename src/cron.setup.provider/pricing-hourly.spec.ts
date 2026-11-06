import { CronTime } from 'cron';
import { cronConfig } from './cron.setup';

describe('часовой интервал проверок цен', () => {
    it.each(['ozonPromoSweepMin', 'wbHoldMinPrices'])('%s запускается один раз в час в production', name => {
        const setup = cronConfig[name].production;
        expect(typeof setup).toBe('object');
        if (typeof setup === 'boolean') throw new Error('Нет расписания');
        expect(setup.enabled).toBe(true);
        const next = new CronTime(setup.settings.time).sendAt(3);
        expect(next[1].toMillis() - next[0].toMillis()).toBe(60 * 60 * 1000);
        expect(next[2].toMillis() - next[1].toMillis()).toBe(60 * 60 * 1000);
        expect(cronConfig[name].development).toBe(false);
    });
});
