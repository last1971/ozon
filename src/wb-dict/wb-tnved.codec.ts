import { WbTnvedEntry } from '../interfaces/i.wb.dict.context';

/**
 * Как справочник предмета лежит в WB_CATEGORIES.TNVED_LIST: коды через запятую,
 * маркируемый (isKiz) со звёздочкой — «8504408300*,8532220000». Человеку в IBExpert
 * читается без расшифровки, машине — две функции ниже. Формат один, менять здесь.
 */
const KIZ_MARK = '*';

export function serializeTnved(entries: WbTnvedEntry[]): string {
    return entries
        .map((e) => String(e.tnved ?? '').trim())
        .map((code, i) => (code ? code + (entries[i].isKiz ? KIZ_MARK : '') : ''))
        .filter(Boolean)
        .join(',');
}

export function parseTnved(text: string | null | undefined): WbTnvedEntry[] {
    if (!text) return [];
    return text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.endsWith(KIZ_MARK) ? { tnved: s.slice(0, -1), isKiz: true } : { tnved: s, isKiz: false }));
}
