import { BadRequestException } from '@nestjs/common';
import Excel from 'exceljs';

/**
 * Читает значения одного столбца xlsx по его заголовку.
 * В первой строке ищет любой из `headerNames`, ниже собирает непустые trimmed-значения.
 * Единственная реализация разбора xlsx-столбца — переиспользуется всеми, кому нужен список из файла.
 */
export async function readColumnByHeader(buffer: Buffer, headerNames: string[]): Promise<string[]> {
    const workbook = new Excel.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Пустой xlsx-файл');

    let col = 0;
    worksheet.getRow(1).eachCell((cell, colNumber) => {
        if (headerNames.includes(cell.value?.toString()?.trim())) col = colNumber;
    });
    if (!col) {
        throw new BadRequestException(`Не найдена колонка ${headerNames.map((n) => `«${n}»`).join('/')}`);
    }

    const values: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const value = row.getCell(col).value?.toString()?.trim();
        if (value) values.push(value);
    });
    return values;
}
