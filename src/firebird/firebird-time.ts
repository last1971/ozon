import { DateTime } from 'luxon';

/** Обе базы Trade хранят TIMESTAMP как часы UTC+7, без пояса (сверено с CURRENT_TIMESTAMP и ISO событий).
 * Не меняем глобальный драйвер: календарные DATE и остальные таблицы имеют свои контракты.
 */
export const FIREBIRD_TIMESTAMP_ZONE = 'UTC+7';
/** Драйвер декодирует DB wall clock в локальный Date процесса; восстанавливаем реальный момент. */
export function fromFirebirdTimestamp(value: Date | string | null | undefined): Date | null {
    if (value == null) return null;
    let time: DateTime;
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw new Error('Некорректный TIMESTAMP Firebird');
        time = DateTime.fromObject(
            {
                year: value.getFullYear(),
                month: value.getMonth() + 1,
                day: value.getDate(),
                hour: value.getHours(),
                minute: value.getMinutes(),
                second: value.getSeconds(),
                millisecond: value.getMilliseconds(),
            },
            { zone: FIREBIRD_TIMESTAMP_ZONE },
        );
    } else
        time = value.includes('T')
            ? DateTime.fromISO(value, { zone: FIREBIRD_TIMESTAMP_ZONE })
            : DateTime.fromSQL(value, { zone: FIREBIRD_TIMESTAMP_ZONE });
    if (!time.isValid) throw new Error('Некорректный TIMESTAMP Firebird');
    return time.toJSDate();
}
/** VARCHAR внутри CAST не даёт драйверу повторно интерпретировать строку в локальном поясе. */
export const FIREBIRD_TIMESTAMP_PARAM = 'CAST(CAST(? AS VARCHAR(32)) AS TIMESTAMP)';
export function toFirebirdTimestamp(value: Date): string {
    const time = DateTime.fromJSDate(value, { zone: FIREBIRD_TIMESTAMP_ZONE });
    if (!time.isValid) throw new Error('Некорректная дата для TIMESTAMP Firebird');
    return time.toFormat('yyyy-MM-dd HH:mm:ss.SSS');
}
/** Поля DATE — календарные значения, к ним нельзя применять преобразование часового пояса. */
export function fromFirebirdDate(value: Date | string): string {
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw new Error('Некорректная DATE Firebird');
        return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const day = String(value).slice(0, 10);
    if (!DateTime.fromISO(day).isValid) throw new Error('Некорректная DATE Firebird');
    return day;
}
