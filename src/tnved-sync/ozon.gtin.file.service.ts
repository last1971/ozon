import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Excel from 'exceljs';
import { GtinCheckItem } from '../interfaces/i.gtin.sync';
import { resolveInstance } from '../notify/instance';

/**
 * «Шаблон для загрузки GTIN» Озона — единственное место, знающее его формат. Шаблон кабинет выдаёт сам
 * (06.10.2026): лист «Страница 1», две строки шапки (имена и пояснения), данные с 3-й строки:
 * Название | SKU | Категория | Признак «Нужна маркировка» | Рекомендация | GTIN.
 *
 * Строка — на КАЖДУЮ карточку товара с GTIN в базе: фасовкам GTIN через API не положить (баркод уникален
 * в кабинете), а базовой карточке GTIN в баркодах проверка маркировки Озона засчитывает не всегда (розница,
 * 355164-1: GTIN в баркодах стоит, в отчёте «Добавьте GTIN»). SKU — тот, что показывает кабинет (cabinetId):
 * у карточки с двумя источниками он отличается от sku из API, и строки с «не тем» SKU Озон молча не применяет.
 * Категория и рекомендация — столбцы Озона, остаются пустыми.
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

    constructor(private readonly config: ConfigService) {}

    /** Строки файла: карточка с SKU и GTIN товара (что добавить, иначе первый GTIN базы); без SKU — не попадёт. */
    static rows(items: GtinCheckItem[]): { name: string; sku: number; gtin: string }[] {
        const seen = new Set<number>();
        const rows: { name: string; sku: number; gtin: string }[] = [];
        for (const i of items) {
            const sku = Number(i.cabinetId ?? i.marketId);
            const gtin = i.add?.[0] ?? OzonGtinFileService.firstGtin(i.base);
            if (!sku || !gtin || seen.has(sku)) continue;
            seen.add(sku);
            rows.push({ name: i.name ?? i.offer, sku, gtin });
        }
        return rows;
    }

    /** `base` в решении — строка «GTIN1, GTIN2» для отчёта; берём первый. */
    private static firstGtin(base: string | undefined): string | undefined {
        return (base ?? '')
            .split(',')
            .map((s) => s.trim())
            .find((s) => /^\d{8,14}$/.test(s));
    }

    async build(items: GtinCheckItem[]): Promise<{ filename: string; content: Buffer; rows: number }> {
        const rows = OzonGtinFileService.rows(items);
        const wb = new Excel.Workbook();
        const ws = wb.addWorksheet(OzonGtinFileService.SHEET);
        ws.addRow(OzonGtinFileService.HEAD);
        ws.addRow(OzonGtinFileService.HINT);
        for (const r of rows) ws.addRow([r.name, r.sku, null, 'Есть', null, r.gtin]);
        // GTIN — как текст: числом он потерял бы ведущие нули
        ws.getColumn(6).numFmt = '@';
        const stamp = new Date().toISOString().slice(0, 10);
        return {
            // инсталляция в имени: у опта и розницы разные кабинеты, файлы с одинаковым именем путались (06.10.2026)
            filename: `ozon-gtin-${resolveInstance(this.config)}-${stamp}.xlsx`,
            content: Buffer.from(await wb.xlsx.writeBuffer()),
            rows: rows.length,
        };
    }
}
