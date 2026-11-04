import { BadRequestException } from '@nestjs/common';
import Excel from 'exceljs';
import { createHash } from 'crypto';

export interface PriceBand {
    min: number;
    max: number | null;
    minIncluded: boolean;
    maxIncluded: boolean;
}
export interface CommissionBand extends PriceBand {
    rate: number;
}
export interface CommissionRow {
    mainCategory: string;
    category: string;
    name: string;
    fbo: CommissionBand[];
    fbs: CommissionBand[];
}
export interface LogisticsRow {
    volumeFrom: number;
    volumeTo: number | null;
    origin: string;
    destination: string;
    isDefault: boolean;
    band: PriceBand;
    amount: number;
}
export const normalize = (value: string) =>
    value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
function fail(message: string): never {
    throw new BadRequestException(message);
}
function text(cell: Excel.Cell): string {
    return cell.text.replace(/\s+/g, ' ').trim();
}

export function parsePriceBand(label: string): PriceBand {
    const s = normalize(label)
        .replace(/(\d) (?=\d)/g, '$1')
        .replace(/\s*(?:руб\.?|₽)/g, '')
        .trim();
    let m = s.match(/^(?:для товаров )?до (\d+(?:[.,]\d+)?)$/);
    const num = (v: string) => Number(v.replace(',', '.'));
    if (m) return { min: 0, max: num(m[1]), minIncluded: true, maxIncluded: true };
    m = s.match(/^(?:для товаров )?свыше (\d+(?:[.,]\d+)?)(?: до (\d+(?:[.,]\d+)?))?$/);
    if (m) return { min: num(m[1]), max: m[2] ? num(m[2]) : null, minIncluded: false, maxIncluded: true };
    return fail(`Не понятен диапазон цены «${label}». Прежние тарифы сохранены.`);
}
function validateBands(bands: PriceBand[]) {
    if (!bands.length || bands[0].min !== 0 || bands[bands.length - 1].max !== null)
        fail('Диапазоны цены должны покрывать все цены от 0.');
    bands.forEach((b, i) => {
        if (b.max !== null && b.max <= b.min) fail('Неверные границы цены.');
        if (i && (bands[i - 1].max !== b.min || bands[i - 1].maxIncluded === b.minIncluded))
            fail('Диапазоны цены пересекаются или имеют пропуск.');
    });
}
function number(cell: Excel.Cell, percentage = false): number {
    const v = cell.value;
    // Формулы с сохранённым результатом тоже отклоняем: результат в XLSX может быть устаревшим.
    if (typeof v !== 'number' && typeof v !== 'string') return fail(`Пустая или нечисловая ставка: ${cell.address}.`);
    const s = String(v).trim();
    if (!percentage && s.endsWith('%')) fail(`Нужна стоимость в рублях, а не процент: ${cell.address}.`);
    if (!/^\d+(?:[.,]\d+)?\s*%?$/.test(s)) return fail(`Неверная ставка: ${cell.address}.`);
    let n = Number(s.replace('%', '').trim().replace(',', '.'));
    if (percentage && (s.endsWith('%') || n > 1)) n /= 100;
    if (!Number.isFinite(n) || n < 0 || (percentage && n > 1)) return fail(`Неверная ставка: ${cell.address}.`);
    if (!percentage && Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)
        fail(`Стоимость должна быть указана в рублях и копейках: ${cell.address}.`);
    return Number(n.toFixed(percentage ? 8 : 2));
}
async function load(buffer: Buffer): Promise<Excel.Workbook> {
    if (!buffer?.length || buffer.length > 20 * 1024 * 1024) fail('Нужен XLSX размером до 20 МБ.');
    try {
        const w = new Excel.Workbook();
        await w.xlsx.load(buffer as unknown as ArrayBuffer);
        return w;
    } catch {
        return fail('Не удалось прочитать XLSX. Прежние тарифы сохранены.');
    }
}
function requiredSheet(w: Excel.Workbook, name: string): Excel.Worksheet {
    const s = w.worksheets.find((s) => normalize(s.name) === normalize(name));
    if (!s) return fail(`В файле нет листа «${name}».`);
    return s;
}
function header(s: Excel.Worksheet, required: string[]): { row: number; columns: number[] } {
    for (let row = 1; row <= Math.min(15, s.rowCount); row++) {
        const columns = required.map((label) => {
            const matches: number[] = [];
            s.getRow(row).eachCell((c, col) => {
                if (normalize(text(c)) === normalize(label)) matches.push(col);
            });
            return matches.length === 1 ? matches[0] : 0;
        });
        if (columns.every(Boolean)) return { row, columns };
    }
    return fail(`Не найдены колонки на листе «${s.name}»: ${required.join(', ')}.`);
}
function priceColumns(s: Excel.Worksheet, row: number, excluded: number[], scheme?: string) {
    const columns: { col: number; band: PriceBand }[] = [];
    s.getRow(row).eachCell((cell, col) => {
        if (excluded.includes(col) || !text(cell)) return;
        if (scheme) {
            if (row < 2 || normalize(text(s.getCell(row - 1, col))) !== scheme) return;
        }
        columns.push({ col, band: parsePriceBand(text(cell)) });
    });
    columns.sort((a, b) => a.band.min - b.band.min);
    validateBands(columns.map((c) => c.band));
    return columns;
}

export async function parseCommissions(buffer: Buffer): Promise<CommissionRow[]> {
    const w = await load(buffer);
    const s = requiredSheet(w, 'Прайс РФ (БЗ)');
    const h = header(s, ['Основная категория', 'Категория', 'Тип товара']);
    const fbo = priceColumns(s, h.row, h.columns, 'fbo');
    const fbs = priceColumns(s, h.row, h.columns, 'fbs');
    const rows: CommissionRow[] = [];
    const keys = new Set<string>();
    for (let i = h.row + 1; i <= s.rowCount; i++) {
        const r = s.getRow(i);
        if (!r.hasValues) continue;
        const [mainCategory, category, name] = h.columns.map((c) => text(r.getCell(c)));
        if (!mainCategory || !category || !name) fail(`Не заполнена категория или тип товара, строка ${i}.`);
        const key = [mainCategory, category, name].map(normalize).join('\u0000');
        if (keys.has(key)) fail(`Повтор типа товара «${mainCategory} / ${category} / ${name}».`);
        keys.add(key);
        rows.push({
            mainCategory,
            category,
            name,
            fbo: fbo.map((c) => ({ ...c.band, rate: number(r.getCell(c.col), true) })),
            fbs: fbs.map((c) => ({ ...c.band, rate: number(r.getCell(c.col), true) })),
        });
    }
    if (!rows.length) fail('В файле нет комиссий.');
    return rows;
}

function volume(label: string): { volumeFrom: number; volumeTo: number | null } {
    const s = normalize(label);
    let m = s.match(/^(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*л$/);
    const n = (v: string) => Number(v.replace(',', '.'));
    if (m && n(m[1]) < n(m[2])) return { volumeFrom: n(m[1]), volumeTo: n(m[2]) };
    m = s.match(/^от (\d+(?:[.,]\d+)?)\s*л$/);
    if (m) return { volumeFrom: n(m[1]), volumeTo: null };
    return fail(`Не понятен объём «${label}». Нужен объём в литрах.`);
}
export async function parseLogistics(buffer: Buffer): Promise<LogisticsRow[]> {
    const w = await load(buffer);
    const result: LogisticsRow[] = [];
    const keys = new Set<string>();
    for (const [name, isDefault] of [
        ['Логистика РФ', false],
        ['Тарифы по умолчанию', true],
    ] as const) {
        const s = requiredSheet(w, name);
        const h = header(s, isDefault ? ['Объём товара'] : ['Объём товара', 'Кластер отправления', 'Кластер доставки']);
        const prices = priceColumns(s, h.row, h.columns);
        const groups = new Map<string, { volumeFrom: number; volumeTo: number | null }[]>();
        let count = 0;
        for (let i = h.row + 1; i <= s.rowCount; i++) {
            const r = s.getRow(i);
            if (!r.hasValues) continue;
            const v = volume(text(r.getCell(h.columns[0])));
            const origin = isDefault ? '' : text(r.getCell(h.columns[1]));
            const destination = isDefault ? '' : text(r.getCell(h.columns[2]));
            if (!isDefault && (!origin || !destination || origin.length > 120 || destination.length > 120))
                fail(`Не заполнен или слишком длинный кластер, строка ${i}.`);
            const key = JSON.stringify([isDefault, normalize(origin), normalize(destination), v.volumeFrom]);
            if (keys.has(key)) fail(`Повтор тарифа доставки, строка ${i}.`);
            keys.add(key);
            const group = JSON.stringify([normalize(origin), normalize(destination)]);
            groups.set(group, [...(groups.get(group) || []), v]);
            for (const c of prices)
                result.push({ ...v, origin, destination, isDefault, band: c.band, amount: number(r.getCell(c.col)) });
            count++;
        }
        if (!count) fail(`Нет тарифов на листе «${name}».`);
        for (const intervals of groups.values()) {
            intervals.sort((a, b) => a.volumeFrom - b.volumeFrom);
            if (intervals[0].volumeFrom !== 0 || intervals[intervals.length - 1].volumeTo !== null)
                fail(`Неполные диапазоны объёма на листе «${name}».`);
            intervals.forEach((v, i) => {
                if (
                    i &&
                    (intervals[i - 1].volumeTo === null ||
                        Math.abs(v.volumeFrom - intervals[i - 1].volumeTo - 0.001) > 1e-8)
                )
                    fail(`Пропуск или пересечение объёмов на листе «${name}».`);
                if (
                    Math.abs(v.volumeFrom * 1000 - Math.round(v.volumeFrom * 1000)) > 1e-6 ||
                    (v.volumeTo !== null && Math.abs(v.volumeTo * 1000 - Math.round(v.volumeTo * 1000)) > 1e-6)
                )
                    fail('Объём должен иметь не более трёх знаков после запятой.');
            });
        }
    }
    return result;
}

export function sourceMetadata(buffer: Buffer, filename: string, now = new Date()) {
    const safeName = filename.split(/[\\/]/).pop();
    const m = safeName?.match(/_(\d{2})(\d{2})(\d{4})_|-(\d{2})(\d{2})(\d{4})_/);
    if (!m || !/\.xlsx$/i.test(safeName) || safeName.length > 255)
        fail('В имени XLSX нужна дата ДДММГГГГ перед подчёркиванием.');
    const day = Number(m[1] || m[4]),
        month = Number(m[2] || m[5]),
        year = Number(m[3] || m[6]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        date.getTime() > now.getTime()
    )
        fail('В имени файла неверная или будущая дата.');
    return {
        filename: safeName,
        fileDate: date.toISOString().slice(0, 10),
        uploadedAt: now,
        hash: createHash('sha256').update(buffer).digest('hex'),
    };
}

export function matchCommissions(
    rows: CommissionRow[],
    types: { TYPE_ID: number; TYPE_NAME: string; CATEGORY_PATH: string }[],
) {
    const byName = new Map<string, CommissionRow[]>();
    for (const r of rows) byName.set(normalize(r.name), [...(byName.get(normalize(r.name)) || []), r]);
    const missing: { id: number; name: string }[] = [];
    const updates: { typeId: number; fbo: CommissionBand[]; fbs: CommissionBand[] }[] = [];
    for (const t of types) {
        const candidates = byName.get(normalize(t.TYPE_NAME || '')) || [];
        if (!candidates.length) {
            missing.push({ id: t.TYPE_ID, name: t.TYPE_NAME });
            continue;
        }
        let chosen: CommissionRow;
        if (candidates.length === 1) chosen = candidates[0];
        else {
            const path = (t.CATEGORY_PATH || '').split(/\s*->\s*/).map(normalize);
            const matches = candidates.filter(
                (r) =>
                    path.length >= 3 &&
                    path[0] === normalize(r.mainCategory) &&
                    path[path.length - 2] === normalize(r.category),
            );
            if (matches.length === 1) chosen = matches[0];
            else if (
                candidates.every(
                    (r) => JSON.stringify([r.fbo, r.fbs]) === JSON.stringify([candidates[0].fbo, candidates[0].fbs]),
                )
            )
                chosen = candidates[0];
            else
                fail(
                    `Неоднозначная комиссия: тип ${t.TYPE_ID} «${t.TYPE_NAME}», путь «${t.CATEGORY_PATH}». Прежние тарифы сохранены.`,
                );
        }
        updates.push({ typeId: t.TYPE_ID, fbo: chosen.fbo, fbs: chosen.fbs });
    }
    if (!updates.length) fail('Ни один тип товара не сопоставлен. Прежние тарифы сохранены.');
    return { updates, missing };
}
