import Excel from 'exceljs';
import JSZip from 'jszip';
import { goodCode, goodQuantityCoeff } from '../helpers/product/product.helpers';

/** Лист и столбцы шаблона Озона «Состав грузомест» (QR-коды для товаров, размещение в ПВЗ). */
const SHEET = 'Состав грузомест';
const COL = { barcode: 1, offerId: 2, expires: 3, cargoId: 4, cargoType: 5, qr: 6 } as const;

/** Строка шаблона: один экземпляр товара в грузоместе. */
export interface TemplateRow {
    /** Номер строки листа — по нему заполняем QR при выгрузке. */
    row: number;
    ozonBarcode: string;
    offerId: string;
    cargoId: string;
    cargoType: string;
    qr: string;
}

/** Артикул коробки: сколько экземпляров нужно и чем он является у нас. */
export interface TemplateLine {
    offerId: string;
    ozonBarcode: string;
    goodscode: number | null;
    /** Фасовка: «555555-10» — 10 шт нашего товара в одном экземпляре Озона. */
    pieces: number;
    need: number;
}

export interface TemplateBox {
    cargoId: string;
    cargoType: string;
    lines: TemplateLine[];
}

const text = (cell: Excel.Cell): string => String(cell?.text ?? '').trim();

function sheetOf(wb: Excel.Workbook): Excel.Worksheet {
    const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
    if (!ws) throw new Error('В файле нет листа «Состав грузомест»');
    return ws;
}

/** Строки шаблона по порядку листа; пустые строки пропускаем. */
export function templateRows(ws: Excel.Worksheet): TemplateRow[] {
    const rows: TemplateRow[] = [];
    ws.eachRow((r, n) => {
        if (n === 1) return;
        const offerId = text(r.getCell(COL.offerId));
        const cargoId = text(r.getCell(COL.cargoId));
        if (!offerId && !cargoId) return;
        rows.push({
            row: n,
            ozonBarcode: text(r.getCell(COL.barcode)),
            offerId,
            cargoId,
            cargoType: text(r.getCell(COL.cargoType)),
            qr: text(r.getCell(COL.qr)),
        });
    });
    return rows;
}

/** Код нашего товара по артикулу Озона; не число — артикул не наш, привязать нельзя. */
export function offerGoodscode(offerId: string): number | null {
    const gc = goodCode({ offer_id: offerId });
    return /^\d+$/.test(gc) ? Number(gc) : null;
}

/** Коробки и их артикулы в порядке листа. */
export function templateBoxes(rows: TemplateRow[]): TemplateBox[] {
    const boxes = new Map<string, TemplateBox>();
    for (const r of rows) {
        if (!r.cargoId || !r.offerId) throw new Error(`Строка ${r.row}: нет артикула или штрихкода грузоместа`);
        const box = boxes.get(r.cargoId) ?? { cargoId: r.cargoId, cargoType: r.cargoType, lines: [] };
        boxes.set(r.cargoId, box);
        const line = box.lines.find((l) => l.offerId === r.offerId);
        if (line) line.need++;
        else
            box.lines.push({
                offerId: r.offerId,
                ozonBarcode: r.ozonBarcode,
                goodscode: offerGoodscode(r.offerId),
                pieces: goodQuantityCoeff({ offer_id: r.offerId }),
                need: 1,
            });
    }
    return [...boxes.values()];
}

/**
 * Файл из ЛК Озона exceljs не читает: XML с префиксом пространства имён (<x:workbook>, <x:sheet>)
 * и абсолютные пути частей (Target="/xl/worksheets/sheet1.xml"). Приводим к виду, как пишет Excel;
 * данные не меняются. Файл уже в обычном виде (пересохранённый) проходит как есть.
 */
export async function normalizeXlsx(buffer: Buffer): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    let changed = false;
    for (const name of Object.keys(zip.files)) {
        if (!/\.(xml|rels)$/.test(name) || zip.files[name].dir) continue;
        const xml = await zip.file(name).async('string');
        const fixed = xml
            .replace(/^\uFEFF/, '')
            .replace(/<(\/?)x:/g, '<$1')
            .replace(/xmlns:x=/g, 'xmlns=')
            .replace(/Target="\/xl\//g, name === 'xl/_rels/workbook.xml.rels' ? 'Target="' : 'Target="/xl/');
        if (fixed !== xml) {
            zip.file(name, fixed);
            changed = true;
        }
    }
    return changed ? zip.generateAsync({ type: 'nodebuffer' }) : buffer;
}

export async function readTemplate(
    buffer: Buffer,
): Promise<{ wb: Excel.Workbook; ws: Excel.Worksheet; rows: TemplateRow[] }> {
    const wb = new Excel.Workbook();
    await wb.xlsx.load((await normalizeXlsx(buffer)) as unknown as ArrayBuffer);
    const ws = sheetOf(wb);
    return { wb, ws, rows: templateRows(ws) };
}

/**
 * Тот же файл Озона с заполненным столбцом QR: привязанные этикетки раскладываются по строкам
 * своей коробки и артикула в порядке листа. Остальное в файле не трогаем — Озон ждёт свой шаблон.
 * @returns сколько строк осталось без QR.
 */
export function fillQr(
    ws: Excel.Worksheet,
    rows: TemplateRow[],
    bound: { cargoId: string; offerId: string; qr: string }[],
): number {
    const queue = new Map<string, string[]>();
    for (const b of bound) {
        const key = `${b.cargoId}|${b.offerId}`;
        queue.set(key, [...(queue.get(key) ?? []), b.qr]);
    }
    let empty = 0;
    for (const r of rows) {
        const qr = queue.get(`${r.cargoId}|${r.offerId}`)?.shift() ?? '';
        ws.getRow(r.row).getCell(COL.qr).value = qr;
        if (!qr) empty++;
    }
    return empty;
}
