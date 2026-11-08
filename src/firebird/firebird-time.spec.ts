import {
    FIREBIRD_TIMESTAMP_PARAM,
    fromFirebirdDate,
    fromFirebirdTimestamp,
    toFirebirdTimestamp,
} from './firebird-time';
import { lossPeriod, lossDate } from '../helpers/price/marketplace.loss.stats';
import { formatMoscowDateTime, moscowIsoDay } from '../shared/moscow-time';

it('09:38 часов базы — 02:38 UTC — 05:38 МСК при любом поясе процесса', () => {
    const at = fromFirebirdTimestamp('2026-11-08 09:38:00.0070');
    expect(at.toISOString()).toBe('2026-11-08T02:38:00.007Z');
    expect(formatMoscowDateTime(at)).toBe('08.11.2026 05:38:00 МСК');
    expect(toFirebirdTimestamp(at)).toBe('2026-11-08 09:38:00.007');
    expect(FIREBIRD_TIMESTAMP_PARAM).toBe('CAST(CAST(? AS VARCHAR(32)) AS TIMESTAMP)');
});
it('календарные DATE не становятся UTC-моментом и сохраняют границы периода', () => {
    expect(fromFirebirdDate(new Date(2026, 7, 10))).toBe('2026-08-10');
    expect(fromFirebirdDate('2026-11-08')).toBe('2026-11-08');
});
it('fallback драйвера читает локальные компоненты как часы базы', () => {
    expect(fromFirebirdTimestamp(new Date(2026, 10, 8, 9, 38)).toISOString()).toBe('2026-11-08T02:38:00.000Z');
});
it.each(['2026-11-08T02:38:00Z', '2026-11-08T05:38:00+03:00', '2026-11-08T09:38:00+07:00'])(
    'известное смещение %s не переинтерпретируется',
    (value) => {
        expect(fromFirebirdTimestamp(value).toISOString()).toBe('2026-11-08T02:38:00.000Z');
    },
);
it.each(['2026-11-07T20:59:59.999Z', '2026-11-07T21:00:00Z', '2026-02-28T21:00:00Z'])(
    'окно 90 дней %s не зависит от транспортного представления',
    (value) => {
        const original = new Date(value);
        const restored = fromFirebirdTimestamp(toFirebirdTimestamp(original));
        expect(restored.getTime()).toBe(original.getTime());
        expect(lossPeriod(restored)).toEqual(lossPeriod(original));
        expect(moscowIsoDay(restored)).toBe(lossPeriod(restored).to);
        const period = lossPeriod(original);
        expect(toFirebirdTimestamp(new Date(lossDate(period.from))).slice(11, 19)).toBe('04:00:00');
    },
);
it('не выдумывает дату для NULL, отклоняет повреждённый timestamp', () => {
    expect(fromFirebirdTimestamp(null)).toBeNull();
    expect(() => fromFirebirdTimestamp('bad')).toThrow();
    expect(() => toFirebirdTimestamp(new Date(NaN))).toThrow();
});
