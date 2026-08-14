import { BadRequestException } from '@nestjs/common';
import Excel from 'exceljs';

/**
 * Загружает xlsx в матрицу строк: каждая ячейка — trimmed string ('' если пусто).
 * Единственная реализация загрузки xlsx — переиспользуется всеми парсерами.
 */
export async function loadRows(buffer: Buffer): Promise<string[][]> {
    const workbook = new Excel.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Пустой xlsx-файл');

    const rows: string[][] = [];
    const width = worksheet.columnCount;
    worksheet.eachRow((row) => {
        const cells: string[] = [];
        for (let c = 1; c <= width; c++) {
            const value = row.getCell(c).value;
            cells.push(value == null ? '' : String(value).trim());
        }
        rows.push(cells);
    });
    return rows;
}

/**
 * Пишет матрицу строк в xlsx-буфер: один лист, без стилей, что передал — то и в ячейках.
 * Единственная реализация записи простых строк — парная к loadRows.
 */
export async function writeRows(rows: (string | number)[][], sheetName = 'Лист1'): Promise<Buffer> {
    const workbook = new Excel.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Индекс столбца по совпадению заголовка (первая строка матрицы). -1 если не найден. */
export function findColumnIndex(header: string[], names: string[]): number {
    return header.findIndex((h) => names.includes(h));
}

/**
 * Значения одного столбца xlsx по его заголовку (непустые).
 * В первой строке ищет любой из `headerNames`, ниже собирает значения.
 */
export async function readColumnByHeader(buffer: Buffer, headerNames: string[]): Promise<string[]> {
    const rows = await loadRows(buffer);
    if (!rows.length) return [];
    const col = findColumnIndex(rows[0], headerNames);
    if (col < 0) {
        throw new BadRequestException(`Не найдена колонка ${headerNames.map((n) => `«${n}»`).join('/')}`);
    }
    return rows.slice(1).map((r) => r[col]).filter(Boolean);
}
