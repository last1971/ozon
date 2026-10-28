import { extractGtin, extractKi } from '../helpers';
import { MarkState } from './supply-qr.store';
import { TemplateLine } from './supply-template';

export type ScanKind = 'qr' | 'cargo' | 'km' | 'barcode' | 'unknown';

/** Этикетка экземпляра Озона: ii + цифры («ii5012699 5216» на этикетке). */
const QR_RE = /^ii\d{6,}$/i;
/** Штрихкод грузоместа — ID грузового места Озона, 16 цифр. */
const CARGO_RE = /^\d{16}$/;
/** Штрихкод товара: EAN-8, UPC-A, EAN-13, GTIN-14. */
const BARCODE_RE = /^(\d{8}|\d{12}|\d{13}|\d{14})$/;

export function normalizeQr(raw: string): string {
    return raw.trim().toLowerCase();
}

/** КМ — то, из чего единая читалка достаёт KI с GTIN; всё прочее кодом маркировки не считаем. */
export function kiOf(raw: string): string | null {
    try {
        const ki = extractKi(raw);
        return extractGtin(ki) ? ki : null;
    } catch {
        return null;
    }
}

/** Что отсканировали. Коробка и штрихкод товара оба из цифр — коробку отличает длина 16. */
export function classifyScan(raw: string): ScanKind {
    const s = (raw ?? '').trim();
    if (!s) return 'unknown';
    if (QR_RE.test(s)) return 'qr';
    if (CARGO_RE.test(s)) return 'cargo';
    if (kiOf(s)) return 'km';
    if (BARCODE_RE.test(s)) return 'barcode';
    return 'unknown';
}

/** Варианты записи GTIN в классификаторе: 14 знаков с ведущими нулями и без одного нуля (EAN-13). */
export function gtinVariants(code: string): string[] {
    const g14 = code.padStart(14, '0');
    return [...new Set([g14, g14.replace(/^0/, ''), code])];
}

/** FBO-счёт поставки Озона: «2000062193308 Новосибирск FORFBO» в примечании. */
const isForFbo = (prim: string | null) => /FORFBO/i.test(prim ?? '');

/**
 * Можно ли отправить код в поставку FBO — решение владельца 28.10: только код, который можно продать.
 * Годится свободный в остатке либо уже привязанный к строке FBO-счёта этого же товара.
 * @returns причина отказа или null.
 */
export function markRefusal(m: MarkState): string | null {
    if (m.status < 5) return 'код не введён в оборот';
    if (m.status > 5) return 'код выведен из оборота (продан или списан)';
    if (m.transferType === 1 || m.transferType === 3) return 'код уже передан покупателю';
    if (m.realpricecode === null) return m.transferType === 0 ? null : 'код уже передан маркетплейсу без счёта';
    if (isForFbo(m.invoicePrim) && m.lineGoodscode === m.goodscode) return null;
    return `код в резерве под счёт №${m.invoiceNumber ?? '?'}`;
}

/**
 * Артикулы текущей коробки, которыми может быть отсканированный товар.
 * Количественный код ЧЗ подходит только к фасовке своего количества (код на 10 шт — к «-10»).
 */
export function matchLines(lines: TemplateLine[], goodscodes: number[], quantity: number | null): TemplateLine[] {
    return lines.filter(
        (l) => l.goodscode !== null && goodscodes.includes(l.goodscode) && (quantity === null || l.pieces === quantity),
    );
}
