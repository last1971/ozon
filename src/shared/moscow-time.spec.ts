import {
    formatMoscowDateTime,
    formatMoscowDay,
    formatMoscowShortDateTime,
    formatMoscowTime,
    moscowIsoDay,
} from './moscow-time';
it('одинаковый момент имеет одно явно московское представление', () => {
    for (const at of ['2026-11-08T02:38:00Z', '2026-11-08T05:38:00+03:00', '2026-11-08T09:38:00+07:00']) {
        expect(formatMoscowDateTime(at)).toBe('08.11.2026 05:38:00 МСК');
        expect(formatMoscowShortDateTime(at)).toBe('08.11 05:38 МСК');
        expect(formatMoscowTime(at)).toBe('05:38 МСК');
    }
});
it('полночь, календарный день и високосная дата не зависят от пояса браузера', () => {
    expect(formatMoscowDateTime('2026-11-07T21:00:00Z')).toBe('08.11.2026 00:00:00 МСК');
    expect(moscowIsoDay(new Date('2026-11-07T20:59:59Z'))).toBe('2026-11-07');
    expect(moscowIsoDay(new Date('2026-11-07T21:00:00Z'))).toBe('2026-11-08');
    expect(formatMoscowDay('2024-02-29')).toBe('29.02.2024');
    expect(formatMoscowDay('2026-02-29')).toBe('—');
});
it('строка без пояса не получает придуманное UTC/местное смещение', () => {
    expect(formatMoscowDateTime('2026-11-08T09:38:00')).toContain('пояс не указан');
    expect(formatMoscowDateTime(null, 'нет данных')).toBe('нет данных');
    expect(formatMoscowDateTime('bad')).toBe('—');
});
