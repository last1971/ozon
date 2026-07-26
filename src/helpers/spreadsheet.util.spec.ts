import Excel from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { readColumnByHeader } from './spreadsheet.util';

/** Собирает xlsx-буфер из массива строк (первая строка — заголовки). */
async function xlsx(rows: (string | number | null)[][]): Promise<Buffer> {
    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet('sheet');
    rows.forEach((row) => worksheet.addRow(row));
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

describe('readColumnByHeader', () => {
    it('возвращает значения столбца по совпавшему заголовку', async () => {
        const buffer = await xlsx([
            ['Артикул продавца', 'Цена'],
            ['A-1', 100],
            ['A-2', 200],
        ]);
        expect(await readColumnByHeader(buffer, ['Артикул продавца', 'Артикул'])).toEqual(['A-1', 'A-2']);
    });

    it('находит столбец по альтернативному имени заголовка', async () => {
        const buffer = await xlsx([['Артикул'], ['B-1'], ['B-2']]);
        expect(await readColumnByHeader(buffer, ['Артикул продавца', 'Артикул'])).toEqual(['B-1', 'B-2']);
    });

    it('пропускает пустые ячейки и триммит значения', async () => {
        const buffer = await xlsx([['Артикул'], [' C-1 '], [null], ['']]);
        expect(await readColumnByHeader(buffer, ['Артикул'])).toEqual(['C-1']);
    });

    it('кидает BadRequestException, если столбец не найден', async () => {
        const buffer = await xlsx([['Что-то другое'], ['X']]);
        await expect(readColumnByHeader(buffer, ['Артикул'])).rejects.toBeInstanceOf(BadRequestException);
    });
});
