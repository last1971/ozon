import Excel from 'exceljs';
import { parseCommissions, parseLogistics, parsePriceBand, sourceMetadata, matchCommissions } from './tariff.xlsx';
import { OzonTariffService } from './tariff.service';
import { OzonCategoryService } from './ozon.category.service';
import { NotifierService } from '../notify/notifier.service';
import { cronConfig } from '../cron.setup.provider/cron.setup';

const commissionName = 'Tablica_kategoriy_dlya_rascheta_voznagrazhdeniya_07102026_123.xlsx';
const logisticsName = 'logistika-fbo-fbs-30102026_123 (1).xlsx';
async function commissions(
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
async function logistics(
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

describe('XLSX тарифов Ozon', () => {
    it('читает комиссии, дробные ставки и границы включительно', async () => {
        const rows = await parseCommissions(await commissions());
        expect(rows).toHaveLength(1);
        expect(rows[0].fbo).toHaveLength(3);
        expect(rows[0].fbo[1]).toEqual({ min: 100, max: 300, minIncluded: false, maxIncluded: true, rate: 0.47 });
        expect(rows[0].fbs[2].max).toBeNull();
    });
    it('находит колонки по заголовкам после перестановки', async () => {
        const [row] = await parseCommissions(await commissions({ reorder: true }));
        expect(row).toMatchObject({ name: 'Светоотражатель', mainCategory: 'Автотовары' });
    });
    it('читает изменённое число и границы ступеней', async () => {
        const [row] = await parseCommissions(
            await commissions({
                bands: ['до 200 руб.', 'свыше 200 до 500 руб.', 'свыше 500 до 1000 руб.', 'свыше 1000 руб.'],
            }),
        );
        expect(row.fbs.map((b) => b.max)).toEqual([200, 500, 1000, null]);
    });
    it('отклоняет пустую комиссию', async () => {
        await expect(parseCommissions(await commissions({ invalid: true }))).rejects.toThrow('ставка');
    });
    it.each([
        ['до 100 руб.', 'свыше 200 руб.'],
        ['до 200 руб.', 'свыше 100 руб.'],
    ])('отклоняет пропуски и пересечения цены %s', async (...bands: string[]) => {
        await expect(parseCommissions(await commissions({ bands }))).rejects.toThrow('Диапазоны');
    });
    it('отклоняет непонятный диапазон', () => {
        expect(() => parsePriceBand('по новым правилам')).toThrow('Не понятен');
    });
    it('сопоставляет одинаковые названия по категории', async () => {
        const rows = await parseCommissions(await commissions({ duplicate: true }));
        const { updates } = matchCommissions(rows, [
            {
                TYPE_ID: 1,
                TYPE_NAME: 'Светоотражатель',
                CATEGORY_PATH: 'Автотовары -> Автоаксессуары -> Светоотражатель',
            },
            {
                TYPE_ID: 2,
                TYPE_NAME: 'Светоотражатель',
                CATEGORY_PATH: 'Детские товары -> Безопасность ребенка -> Светоотражатель',
            },
        ]);
        expect(updates.map((r) => r.fbs[2].rate)).toEqual([0.47, 0.52]);
    });
    it('отклоняет неоднозначность, не выбирая последнюю ставку', async () => {
        const rows = await parseCommissions(await commissions({ duplicate: true }));
        expect(() =>
            matchCommissions(rows, [{ TYPE_ID: 1, TYPE_NAME: 'Светоотражатель', CATEGORY_PATH: 'Другая категория' }]),
        ).toThrow('Неоднозначная');
    });
    it('отчитывается об отсутствующих типах', async () => {
        const rows = await parseCommissions(await commissions());
        const result = matchCommissions(rows, [
            { TYPE_ID: 1, TYPE_NAME: 'Светоотражатель', CATEGORY_PATH: '' },
            { TYPE_ID: 2, TYPE_NAME: 'Отсутствует', CATEGORY_PATH: '' },
        ]);
        expect(result.missing).toEqual([{ id: 2, name: 'Отсутствует' }]);
    });
    it('читает маршруты и тарифы по умолчанию, включая открытый объём', async () => {
        const rows = await parseLogistics(await logistics());
        expect(rows).toHaveLength(8);
        expect(rows[0]).toMatchObject({ origin: 'Новосибирск', destination: 'Москва', volumeTo: 1, amount: 21 });
        expect(rows[2].volumeTo).toBeNull();
        expect(rows[4]).toMatchObject({ isDefault: true, origin: '', destination: '' });
        expect(rows[1].band).toEqual({ min: 300, max: null, minIncluded: false, maxIncluded: true });
    });
    it('не принимает проценты вместо рублей за доставку', async () => {
        const w = new Excel.Workbook();
        await w.xlsx.load(await logistics() as unknown as ArrayBuffer);
        w.getWorksheet('Логистика РФ').getCell('E4').value = '21%';
        await expect(parseLogistics(Buffer.from(await w.xlsx.writeBuffer()))).rejects.toThrow('рублях');
    });

    it('не зашивает число ступеней доставки', async () => {
        const rows = await parseLogistics(
            await logistics({
                bands: ['Для товаров до 100 руб.', 'Для товаров свыше 100 до 500 руб.', 'Для товаров свыше 500 руб.'],
            }),
        );
        expect(rows).toHaveLength(12);
        expect(rows[2].band.min).toBe(500);
    });
    it.each([{ bad: true }, { duplicate: true }, { missingSheet: true }, { volume: '0-1 кг' }])(
        'отклоняет неправильную логистику %j',
        async (options) => {
            await expect(parseLogistics(await logistics(options))).rejects.toThrow();
        },
    );
    it('не принимает повреждённый файл', async () => {
        await expect(parseCommissions(Buffer.from('broken'))).rejects.toThrow('XLSX');
        await expect(parseLogistics(Buffer.from('broken'))).rejects.toThrow('XLSX');
    });
    it('читает дату из имени, а не из времени загрузки', () => {
        expect(sourceMetadata(Buffer.from('x'), logisticsName).fileDate).toBe('2026-10-30');
        expect(sourceMetadata(Buffer.from('x'), commissionName).fileDate).toBe('2026-10-07');
        expect(() => sourceMetadata(Buffer.from('x'), 'logistika-31022026_1.xlsx')).toThrow('дата');
    });
    it('использует новые границы включительно и сохраняет чтение старых записей', async () => {
        const service = Object.create(OzonCategoryService.prototype) as OzonCategoryService;
        const modern = (await parseCommissions(await commissions()))[0];
        service.getCommissions = jest.fn().mockResolvedValue(modern);
        expect(await service.getCommissionForPrice(1, 100)).toBe(0.47);
        (service.getCommissions as jest.Mock).mockResolvedValue({
            fbs: [
                { min: 0, max: 100, rate: 0.1, minIncluded: true, maxIncluded: true },
                { min: 100, max: 300, rate: 0.2, minIncluded: false, maxIncluded: true },
                { min: 300, max: null, rate: 0.5, minIncluded: false, maxIncluded: true },
            ],
        });
        expect(await service.getCommissionForPrice(1, 100)).toBe(0.1);
        expect(await service.getCommissionForPrice(1, 300)).toBe(0.2);
        expect(await service.getCommissionForPrice(1, 300.01)).toBe(0.5);
        (service.getCommissions as jest.Mock).mockResolvedValue({
            fbs: [
                { min: 0, max: 100, rate: 0.1 },
                { min: 100, max: null, rate: 0.2 },
            ],
        });
        expect(await service.getCommissionForPrice(1, 100)).toBe(0.2);
    });
});

describe('Чтение комиссий без подстановки нуля', () => {
    it('возвращает null для типа с пустыми комиссиями', async () => {
        const service = Object.create(OzonCategoryService.prototype) as OzonCategoryService;
        const tx = {
            query: jest.fn().mockResolvedValue([{ FBO_COMMISSIONS: null, FBS_COMMISSIONS: null }]),
            commit: jest.fn(),
            rollback: jest.fn(),
        };
        (service as any).pool = { getTransaction: async () => tx };
        expect(await service.getCommissions(1)).toBeNull();
        expect(tx.commit).toHaveBeenCalledWith(true);
    });
});

describe('Сохранение и напоминание тарифов Ozon', () => {
    const make = (env = 'development') => {
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
        const notifier = { notify: jest.fn().mockResolvedValue(true) };
        const service = new OzonTariffService(pool as any, notifier as any, { get: () => env } as any);
        return { tx, pool, notifier, service };
    };
    it('сохраняет комиссии и метаданные одним коммитом', async () => {
        const { tx, service } = make();
        const result = await service.importCommissions(await commissions(), commissionName);
        expect(result.updated).toBe(1);
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(true);
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('FILE_NAME = ?'))).toBe(true);
        expect(tx.commit).toHaveBeenCalledWith(true);
        expect(tx.rollback).not.toHaveBeenCalled();
    });
    it('битый файл не открывает транзакцию и не меняет тарифы', async () => {
        const { pool, service } = make();
        await expect(service.importCommissions(await commissions({ invalid: true }), commissionName)).rejects.toThrow();
        await expect(service.importLogistics(await logistics({ bad: true }), logisticsName)).rejects.toThrow();
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it('неоднозначный тип не приводит к удалению старых комиссий', async () => {
        const { tx, service } = make();
        tx.query.mockImplementation(async (sql) =>
            sql.includes('SELECT KIND FROM')
                ? [{ KIND: 'commissions' }]
                : [{ TYPE_ID: 1, TYPE_NAME: 'Светоотражатель', CATEGORY_PATH: '' }],
        );
        await expect(service.importCommissions(await commissions({ duplicate: true }), commissionName)).rejects.toThrow(
            'Неоднозначная',
        );
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(false);
        expect(tx.rollback).toHaveBeenCalledWith(true);
        expect(tx.commit).not.toHaveBeenCalled();
    });
    it('ошибка записи метаданных откатывает всю замену логистики', async () => {
        const { tx, service } = make();
        tx.execute.mockImplementation(async (sql) => {
            if (sql.includes('FILE_NAME = ?')) throw new Error('disk full');
            return [];
        });
        await expect(service.importLogistics(await logistics(), logisticsName)).rejects.toThrow('disk full');
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('DELETE FROM OZON_LOGISTICS_TARIFF'))).toBe(true);
        expect(tx.rollback).toHaveBeenCalledWith(true);
        expect(tx.commit).not.toHaveBeenCalled();
    });
    it('сохраняет все новые ставки логистики и имя файла', async () => {
        const { tx, service } = make();
        expect(await service.importLogistics(await logistics(), logisticsName)).toMatchObject({
            routeRates: 4,
            defaultRates: 4,
            fileDate: '2026-10-30',
        });
        expect(tx.commit).toHaveBeenCalledTimes(1);
        expect(tx.rollback).not.toHaveBeenCalled();
    });
    it('показывает понятную ошибку, если SQL-патч не применён', async () => {
        const { tx, service } = make();
        tx.query.mockRejectedValue(new Error('Table unknown OZON_TARIFF_SOURCE'));
        await expect(service.info()).rejects.toThrow('SQL-патч');
        expect(tx.rollback).toHaveBeenCalledWith(true);
    });
    it('дата старого файла не обновляется от повторной загрузки', async () => {
        const { tx, service } = make();
        tx.query.mockResolvedValue([
            {
                KIND: 'commissions',
                FILE_DATE: '2020-01-01',
                FILE_NAME: commissionName,
                UPLOADED_AT: new Date(),
                ROWS_COUNT: 1,
            },
        ]);
        expect((await service.info())[0].stale).toBe(true);
    });
    it('напоминает только в production и только в Matrix/PRICES', async () => {
        const { service, notifier } = make('production');
        jest.spyOn(service, 'info').mockResolvedValue([
            { kind: 'logistics', fileDate: '2020-01-01', stale: true },
        ] as any);
        await service.remind();
        expect(notifier.notify).toHaveBeenCalledWith(
            'PRICES',
            expect.objectContaining({ subject: 'Загрузите новые тарифы Ozon' }),
            ['matrix'],
        );
    });
    it('на свежих тарифах и в development не отправляет сообщений', async () => {
        const { service, notifier } = make('production');
        jest.spyOn(service, 'info').mockResolvedValue([]);
        await service.remind();
        expect(notifier.notify).not.toHaveBeenCalled();
        const dev = make();
        await dev.service.remind();
        expect(dev.pool.getTransaction).not.toHaveBeenCalled();
        expect(cronConfig.ozonTariffReminder).toEqual({ production: true, development: false });
    });
    it('ограничение канала в NotifierService исключает отправку почты', async () => {
        const mail = { channel: 'mail' as const, send: jest.fn().mockResolvedValue(true) };
        const matrix = { channel: 'matrix' as const, send: jest.fn().mockResolvedValue(true) };
        const notifier = new NotifierService(
            [mail, matrix],
            { hasRoutes: async () => true, targets: async () => ['test'] } as any,
            { enqueue: jest.fn() } as any,
            {} as any,
            {} as any,
            { get: (key: string) => (key === 'NODE_ENV' ? 'production' : '') } as any,
        );
        await notifier.notify('PRICES' as any, { subject: 'Тарифы', text: 'Обновите' }, ['matrix']);
        expect(matrix.send).toHaveBeenCalledTimes(1);
        expect(mail.send).not.toHaveBeenCalled();
    });
});
