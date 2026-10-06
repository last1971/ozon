import { Injectable } from '@nestjs/common';
import Excel from 'exceljs';
import { GtinCheckItem } from '../interfaces/i.gtin.sync';

/**
 * «Шаблон для загрузки GTIN» Озона — единственное место, знающее его формат. Шаблон кабинет выдаёт сам
 * (06.10.2026): лист «Страница 1», две строки шапки (имена и пояснения), данные с 3-й строки:
 * Название | SKU | Категория | Признак «Нужна маркировка» | Рекомендация | GTIN.
 * Заполняем то, по чему Озон связывает строку с карточкой и что ему нужно: SKU и GTIN (название и признак —
 * для глаз); категория и рекомендация — его столбцы, остаются пустыми.
 */
@Injectable()
export class OzonGtinFileService {
    static readonly SHEET = 'Страница 1';
    static readonly HEAD = [
        'Название товара',
        'SKU',
        'Категория',
        'Признак «Нужна маркировка» в карточке',
        'Рекомендация',
        'GTIN',
    ];
    static readonly HINT = [
        'Название товара в карточке',
        'Уникальный идентификатор товара в системе Ozon',
        'К какой категории относится товар',
        'Есть ли признак маркировки в карточке товара',
        'Что сделать, чтобы товар прошёл проверку маркировки',
        'GTIN в штрихкоде товара',
    ];

    /** Строки файла — решения канала файла с известным SKU и GTIN; карточка без SKU в файл не попадёт. */
    static rows(items: GtinCheckItem[]): { name: string; sku: number; gtin: string }[] {
        return items
            .filter((i) => !i.ok && i.marketId && i.add?.length)
            .map((i) => ({ name: i.name ?? i.offer, sku: Number(i.marketId), gtin: i.add[0] }));
    }

    async build(items: GtinCheckItem[]): Promise<{ filename: string; content: Buffer; rows: number }> {
        const rows = OzonGtinFileService.rows(items);
        const wb = new Excel.Workbook();
        const ws = wb.addWorksheet(OzonGtinFileService.SHEET);
        ws.addRow(OzonGtinFileService.HEAD);
        ws.addRow(OzonGtinFileService.HINT);
        for (const r of rows) ws.addRow([r.name, r.sku, null, 'Есть', null, r.gtin]);
        // SKU и GTIN — как текст: GTIN с ведущими нулями числом потерял бы их
        ws.getColumn(6).numFmt = '@';
        const stamp = new Date().toISOString().slice(0, 10);
        return {
            filename: `ozon-gtin-${stamp}.xlsx`,
            content: Buffer.from(await wb.xlsx.writeBuffer()),
            rows: rows.length,
        };
    }
}
