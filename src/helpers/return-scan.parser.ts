/** Что кладовщик отсканировал или ввёл на экране приёма возврата. */
export type ReturnScan =
    | { kind: 'barcode'; value: string }
    | { kind: 'posting'; value: string }
    | { kind: 'order'; value: string }
    | { kind: 'extId'; value: string };

/** Русская раскладка сканера: латинская «i» приходит как «ш». */
const LAYOUT_II = /^[шШ]{2}/;
/** То же для этикетки возврата Яндекса: «VOZ_FBS_» приходит как «МЩЯ_АИЫ_». */
const LAYOUT_VOZ = /^мщя_аиы_/i;
/**
 * Штрихкод стикера ВБ: «*» + 8 символов base64 = 48 бит, старшие 40 — номер стикера
 * (partA+partB), младший байт служебный. Сверено 30.10.2026 по API стикеров ВБ на 32 возвратах опта.
 */
const WB_STICKER = /^\*([A-Za-z0-9+/]{8})$/;

/**
 * Разбор скана/ввода на экране возвратов. Одна функция на все маркетплейсы:
 *  - `ii18506448347`, `ii1850644 8347`, `шш1850644 8347` → штрихкод возвратной этикетки Ozon;
 *  - `0103411105-0207-1` → номер отправления;
 *  - `0103411105-0207` → номер заказа (отправлений может быть несколько);
 *  - `VOZ_FBS_27059326`, `62026013058-1` → этикетка возврата / коробка невыкупа Яндекса;
 *  - `*DPra4ocl` → стикер ВБ, раскодированный в номер (55748256391), ищется как id;
 *  - только цифры → id возврата у маркетплейса.
 * Номер ищется и внутри длинной строки (QR этикетки может нести больше, чем номер).
 */
export function parseReturnScan(raw: string): ReturnScan | null {
    const text = (raw ?? '').trim().replace(LAYOUT_II, 'ii').replace(LAYOUT_VOZ, 'VOZ_FBS_');
    if (!text) return null;

    const wbSticker = text.match(WB_STICKER);
    if (wbSticker) {
        // 48 бит точно помещаются в number (до 2^53); сдвиг >> работает только на 32 битах — делим
        const id = Math.floor(Buffer.from(wbSticker[1], 'base64').readUIntBE(0, 6) / 256);
        return { kind: 'extId', value: String(id) };
    }

    const barcode = text.match(/ii\s*(\d[\d\s]{6,}\d)/i);
    if (barcode) return { kind: 'barcode', value: 'ii' + barcode[1].replace(/\s+/g, '') };

    const posting = text.match(/\b(\d{6,12}-\d{4}-\d{1,3})\b/);
    if (posting) return { kind: 'posting', value: posting[1] };

    const order = text.match(/\b(\d{6,12}-\d{4})\b/);
    if (order) return { kind: 'order', value: order[1] };

    const yandex = text.match(/\b(VOZ_[A-Z]{3}_\d+|\d{8,12}-\d{1,3})\b/i);
    if (yandex) return { kind: 'barcode', value: yandex[1].toUpperCase() };

    const digits = text.replace(/\s+/g, '');
    if (/^\d{5,20}$/.test(digits)) return { kind: 'extId', value: digits };

    return null;
}
