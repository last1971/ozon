import { describe, expect, it } from 'vitest';
import { formatMoscowDateTime, formatMoscowDay, formatMoscowTime, moscowIsoDay } from '../moscow-time';
describe('московское время интерфейса, общий код с backend', () => {
    it('дата API с UTC не зависит от пояса браузера', () => {
        expect(formatMoscowDateTime('2026-11-08T02:38:00.007Z')).toBe('08.11.2026 05:38:00 МСК');
        expect(formatMoscowTime(Date.parse('2026-11-08T02:38:00Z'))).toBe('05:38 МСК');
    });
    it('переход суток и календарный день не теряются', () => {
        expect(moscowIsoDay(new Date('2026-11-07T21:00:00Z'))).toBe('2026-11-08');
        expect(formatMoscowDay('2026-11-08')).toBe('08.11.2026');
        expect(formatMoscowDateTime('2026-11-07T21:00:00Z')).toBe('08.11.2026 00:00:00 МСК');
    });
    it('историческое время без смещения явно помечается, а не угадывается', () => {
        expect(formatMoscowDateTime('2026-11-08T09:38:00')).toContain('пояс не указан');
    });
});
