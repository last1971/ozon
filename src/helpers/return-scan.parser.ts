/** Что кладовщик отсканировал или ввёл на экране приёма возврата. */
export type ReturnScan =
    | { kind: 'barcode'; value: string }
    | { kind: 'posting'; value: string }
    | { kind: 'order'; value: string }
    | { kind: 'extId'; value: string };

/** Русская раскладка сканера: латинская «i» приходит как «ш». */
const LAYOUT_II = /^[шШ]{2}/;

/**
 * Разбор скана/ввода на экране возвратов. Одна функция на все маркетплейсы:
 *  - `ii18506448347`, `ii1850644 8347`, `шш1850644 8347` → штрихкод возвратной этикетки Ozon;
 *  - `0103411105-0207-1` → номер отправления;
 *  - `0103411105-0207` → номер заказа (отправлений может быть несколько);
 *  - только цифры → id возврата у маркетплейса.
 * Номер ищется и внутри длинной строки (QR этикетки может нести больше, чем номер).
 */
export function parseReturnScan(raw: string): ReturnScan | null {
    const text = (raw ?? '').trim().replace(LAYOUT_II, 'ii');
    if (!text) return null;

    const barcode = text.match(/ii\s*(\d[\d\s]{6,}\d)/i);
    if (barcode) return { kind: 'barcode', value: 'ii' + barcode[1].replace(/\s+/g, '') };

    const posting = text.match(/\b(\d{6,12}-\d{4}-\d{1,3})\b/);
    if (posting) return { kind: 'posting', value: posting[1] };

    const order = text.match(/\b(\d{6,12}-\d{4})\b/);
    if (order) return { kind: 'order', value: order[1] };

    const digits = text.replace(/\s+/g, '');
    if (/^\d{5,20}$/.test(digits)) return { kind: 'extId', value: digits };

    return null;
}
