import Excel from 'exceljs';
export const currentTree = {
    result: [
        {
            category_name: 'Автотовары',
            children: [{ category_name: 'Автоаксессуары', children: [{ type_id: 1, type_name: 'Светоотражатель' }] }],
        },
    ],
};

export const commissionName = 'Tablica_kategoriy_dlya_rascheta_voznagrazhdeniya_07102026_123.xlsx';
export const logisticsName = 'logistika-fbo-fbs-30102026_123 (1).xlsx';
export async function commissions(
    options: { bands?: string[]; duplicate?: boolean; invalid?: boolean; reorder?: boolean } = {},
) {
    const w = new Excel.Workbook();
    const s = w.addWorksheet('Прайс РФ (БЗ)');
    const bands = options.bands || ['до 100 руб.', 'свыше 100 до 300 руб.', 'свыше 300 руб.'];
    const headings = options.reorder
        ? ['Тип товара', 'Категория', 'Основная категория']
        : ['Основная категория', 'Категория', 'Тип товара'];
    s.getRow(2).values = headings;
    for (const [i, scheme] of ['FBO', 'FBS'].entries()) {
        const start = 4 + i * bands.length;
        s.mergeCells(1, start, 1, start + bands.length - 1);
        s.getCell(1, start).value = scheme;
        bands.forEach((b, j) => (s.getCell(2, start + j).value = b));
    }
    const add = (row: number, main: string, category: string, name: string, rate: number) => {
        s.getRow(row).values = options.reorder ? [name, category, main] : [main, category, name];
        for (let i = 4; i < 4 + bands.length * 2; i++) s.getCell(row, i).value = rate;
    };
    add(3, 'Автотовары', 'Автоаксессуары', 'Светоотражатель', 0.47);
    if (options.duplicate) add(4, 'Детские товары', 'Безопасность ребенка', 'Светоотражатель', 0.52);
    if (options.invalid) s.getCell(3, 4).value = null;
    return Buffer.from(await w.xlsx.writeBuffer());
}
export async function logistics(
    options: { bad?: boolean; duplicate?: boolean; missingSheet?: boolean; volume?: string; bands?: string[] } = {},
) {
    const w = new Excel.Workbook();
    for (const name of ['Логистика РФ', 'Тарифы по умолчанию']) {
        if (options.missingSheet && name === 'Тарифы по умолчанию') continue;
        const s = w.addWorksheet(name);
        const route = name === 'Логистика РФ';
        const labels = route ? ['Объём товара', 'Кластер отправления', 'Кластер доставки'] : ['Объём товара'];
        const bands = options.bands || ['Для товаров до 300 руб.', 'Для товаров свыше 300 руб.'];
        s.getRow(3).values = [null, ...labels, ...bands];
        for (const [i, volume] of [options.volume || '0-1 л', 'От 1,001 л'].entries()) {
            s.getRow(4 + i).values = [
                null,
                volume,
                ...(route ? ['Новосибирск', 'Москва'] : []),
                ...bands.map((_, j) => (j ? 80 : 21)),
            ];
        }
        if (options.bad && route) s.getCell('E4').value = null;
        if (options.duplicate && route) s.getRow(6).values = s.getRow(4).values;
    }
    return Buffer.from(await w.xlsx.writeBuffer());
}

import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { ReadTariffFileCommand } from './read-tariff-file.command';
import { ValidateTariffFileCommand } from './validate-tariff-file.command';
import { ParseTariffRowsCommand } from './parse-tariff-rows.command';
import { WriteTariffsCommand } from './write-tariffs.command';
import { SaveTariffDateCommand } from './save-tariff-date.command';
import { TariffImportService } from './tariff-import.service';
import { TariffImportContext, TariffKind } from './tariff-import.context';

export function makeTariffImport() {
    const tx = {
        query: jest
            .fn()
            .mockImplementation(async (sql: string) =>
                sql.includes('SELECT KIND FROM')
                    ? [{ KIND: 'commissions' }]
                    : [
                          {
                              TYPE_ID: 1,
                              TYPE_NAME: 'Светоотражатель',
                              CATEGORY_PATH: 'Автотовары -> Автоаксессуары -> Светоотражатель',
                          },
                      ],
            ),
        execute: jest.fn().mockResolvedValue([]),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(tx) };
    const api = { method: jest.fn().mockResolvedValue(currentTree) };
    const products = {
        listAllOfferIds: jest.fn().mockResolvedValue(['sku-1']),
        infoList: jest.fn().mockResolvedValue([{ sku: 'sku-1', typeId: 1, fbsCount: 0, fboCount: 0 }]),
    };
    const jobs = new JobService();
    const read = new ReadTariffFileCommand();
    const validate = new ValidateTariffFileCommand(products as any, api as any);
    const parse = new ParseTariffRowsCommand();
    const write = new WriteTariffsCommand(pool as any);
    const saveDate = new SaveTariffDateCommand();
    const imports = new TariffImportService(jobs, read, validate, parse, write, saveDate);
    return { tx, pool, api, products, jobs, read, validate, parse, write, saveDate, imports };
}
export async function tariffContext(kind: TariffKind = 'commissions'): Promise<TariffImportContext> {
    return {
        kind,
        filename: kind === 'commissions' ? commissionName : logisticsName,
        buffer: await (kind === 'commissions' ? commissions() : logistics()),
        progress: emptyProgress(),
    };
}
