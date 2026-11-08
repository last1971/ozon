/** Единое отображение абсолютного времени в API-клиенте и уведомлениях. */
export const MOSCOW_TIME_ZONE = 'Europe/Moscow';
type TimeValue = string | number | Date | null | undefined;
function instant(value: TimeValue): Date | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value === 'string' && !/(?:z|[+-]\d{2}:?\d{2})$/i.test(value)) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
}
function display(value: TimeValue, options: Intl.DateTimeFormatOptions, empty: string): string {
    const date = instant(value);
    if (date)
        return `${new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: MOSCOW_TIME_ZONE }).format(date).replace(',', '')} МСК`;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value))
        return `${value.replace('T', ' ')} (пояс не указан)`;
    return empty;
}
export const formatMoscowDateTime = (value: TimeValue, empty = '—'): string =>
    display(
        value,
        {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        },
        empty,
    );
export const formatMoscowTime = (value: TimeValue, empty = '—'): string =>
    display(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, empty);
export const formatMoscowShortDateTime = (value: TimeValue, empty = '—'): string =>
    display(value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, empty);
/** Календарный день не преобразуется в момент времени и не сдвигается по поясам. */
export function formatMoscowDay(value: TimeValue, empty = '—'): string {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(`${value}T12:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return empty;
        return value.split('-').reverse().join('.');
    }
    const date = instant(value);
    return date
        ? new Intl.DateTimeFormat('ru-RU', {
              timeZone: MOSCOW_TIME_ZONE,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
          }).format(date)
        : empty;
}
export function moscowIsoDay(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: MOSCOW_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const get = (key: string) => parts.find((p) => p.type === key)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}
