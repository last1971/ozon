/** Приводит вход к чистому списку строк: массив как есть, одиночную строку в [строку], пусто в []. */
export const toStringList = ({ value }: { value: unknown }): string[] =>
    (Array.isArray(value) ? value : value != null && value !== '' ? [value] : [])
        .map((v) => String(v).trim())
        .filter(Boolean);
