import {
    commissions,
    logistics,
    commissionName,
    logisticsName,
    currentTree,
    makeTariffImport,
} from './import/tariff-import.fixtures';
import Excel from 'exceljs';
import {
    commissionTypesFromTree,
    parseCommissions,
    parseLogistics,
    parsePriceBand,
    sourceMetadata,
    matchCommissions,
} from './tariff.xlsx';
import { OzonTariffService } from './tariff.service';
import { OzonCategoryService } from './ozon.category.service';
import { NotifierService } from '../notify/notifier.service';
import { cronConfig } from '../cron.setup.provider/cron.setup';

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
    it('один официальный ID в нескольких ветках дерева сохраняет пути и выбирает категорию строки', async () => {
        const current = commissionTypesFromTree({
            result: [
                {
                    category_name: 'Автотовары',
                    children: [
                        { category_name: 'Автоаксессуары', children: [{ type_id: 1, type_name: 'Светоотражатель' }] },
                    ],
                },
                {
                    category_name: 'Детские товары',
                    children: [
                        {
                            category_name: 'Безопасность ребенка',
                            children: [{ type_id: 1, type_name: 'Светоотражатель' }],
                        },
                    ],
                },
            ],
        });
        expect(current.get(1).CATEGORY_PATHS).toHaveLength(2);
        const result = matchCommissions(
            await parseCommissions(await commissions({ duplicate: true })),
            [
                {
                    TYPE_ID: 1,
                    TYPE_NAME: 'Светоотражатель',
                    CATEGORY_PATH: 'Детские товары -> Безопасность ребенка -> Светоотражатель',
                },
            ],
            current,
        );
        expect(result.updates[0].fbs[0].rate).toBe(0.52);
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
        await w.xlsx.load((await logistics()) as unknown as ArrayBuffer);
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
        const { tx, pool, api, products, imports } = makeTariffImport();
        const notifier = { notify: jest.fn().mockResolvedValue(true) };
        const service = new OzonTariffService(pool as any, notifier as any, { get: () => env } as any, imports);
        return { tx, pool, notifier, service, api, products };
    };
    it('сопоставляет переименованный тип по официальному ID', async () => {
        const { tx, service, api } = make();
        tx.query.mockImplementation(async (sql) =>
            sql.includes('SELECT KIND FROM')
                ? [{ KIND: 'commissions' }]
                : [{ TYPE_ID: 1, TYPE_NAME: 'Старое название', CATEGORY_PATH: 'Старый путь' }],
        );
        expect(await service.importCommissions(await commissions(), commissionName)).toMatchObject({
            updated: 1,
            missingCount: 0,
            retiredCount: 0,
        });
        expect(api.method).toHaveBeenCalledWith('/v1/description-category/tree', {});
    });

    it('устаревший тип отключается явно, не получает случайную или нулевую ставку', async () => {
        const { tx, service } = make();
        tx.query.mockImplementation(async (sql) =>
            sql.includes('SELECT KIND FROM')
                ? [{ KIND: 'commissions' }]
                : [
                      {
                          TYPE_ID: 1,
                          TYPE_NAME: 'Светоотражатель',
                          CATEGORY_PATH: 'Автотовары -> Автоаксессуары -> Светоотражатель',
                      },
                      { TYPE_ID: 99, TYPE_NAME: 'Удалённый тип', CATEGORY_PATH: '' },
                  ],
        );
        expect(await service.importCommissions(await commissions(), commissionName)).toMatchObject({
            updated: 1,
            missingCount: 0,
            retiredCount: 1,
            retiredTypes: [{ id: 99, name: 'Удалённый тип' }],
        });
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('SET DISABLED = 1 WHERE TYPE_ID = 99'))).toBe(true);
    });

    it('импорт не включает ранее отключённый тип даже при наличии его ID в другой ветке Ozon', async () => {
        const { tx, service, api } = make();
        api.method.mockResolvedValue({
            result: [
                {
                    category_name: 'Автотовары',
                    children: [
                        {
                            category_name: 'Автоаксессуары',
                            children: [
                                { type_id: 1, type_name: 'Светоотражатель' },
                                { type_id: 99, type_name: 'Светоотражатель' },
                            ],
                        },
                    ],
                },
            ],
        });
        tx.query.mockImplementation(async (sql) =>
            sql.includes('SELECT KIND FROM')
                ? [{ KIND: 'commissions' }]
                : [
                      {
                          TYPE_ID: 1,
                          TYPE_NAME: 'Светоотражатель',
                          CATEGORY_PATH: 'Автотовары -> Автоаксессуары -> Светоотражатель',
                          DISABLED: 0,
                      },
                      { TYPE_ID: 99, TYPE_NAME: 'Светоотражатель', CATEGORY_PATH: 'Удалённая ветка', DISABLED: 1 },
                  ],
        );
        expect(await service.importCommissions(await commissions(), commissionName)).toMatchObject({
            updated: 1,
            missingCount: 0,
            retiredCount: 1,
        });
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('DISABLED = 0 WHERE TYPE_ID = 99'))).toBe(false);
    });

    it('отсутствующая ставка действующего типа блокирует весь импорт', async () => {
        const { tx, service, api } = make();
        api.method.mockResolvedValue({
            result: [{ category_name: 'Автотовары', children: [{ type_id: 1, type_name: 'Новый тип без ставки' }] }],
        });
        tx.query.mockImplementation(async (sql) =>
            sql.includes('SELECT KIND FROM')
                ? [{ KIND: 'commissions' }]
                : [{ TYPE_ID: 1, TYPE_NAME: 'Неизвестен файлу', CATEGORY_PATH: '' }],
        );
        await expect(service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
            'действующих типов',
        );
        expect(tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(false);
        expect(tx.rollback).toHaveBeenCalledWith(true);
    });

    it('сохраняет файл и предупреждает о типе, которого нет среди товаров кабинета', async () => {
        const m = make();
        m.api.method.mockResolvedValue({
            result: [
                {
                    category_name: 'Автотовары',
                    children: [
                        { type_id: 1, type_name: 'Светоотражатель' },
                        { type_id: 2, type_name: 'Блинница электрическая' },
                    ],
                },
            ],
        });
        m.tx.query.mockImplementation(async (sql) =>
            sql.includes('SELECT KIND FROM')
                ? [{ KIND: 'commissions' }]
                : [
                      {
                          TYPE_ID: 1,
                          TYPE_NAME: 'Светоотражатель',
                          CATEGORY_PATH: 'Автотовары -> Автоаксессуары -> Светоотражатель',
                      },
                      { TYPE_ID: 2, TYPE_NAME: 'Блинница электрическая', CATEGORY_PATH: '' },
                  ],
        );
        const result = await m.service.importCommissions(await commissions(), commissionName);
        expect(result).toMatchObject({
            updated: 1,
            missingCount: 1,
            missingTypes: [{ id: 2, name: 'Блинница электрическая' }],
            retiredCount: 0,
        });
        expect(m.tx.commit).toHaveBeenCalledTimes(1);
        expect(m.tx.rollback).not.toHaveBeenCalled();
        // Старая ставка отсутствующего типа очищена; выдуманной ставки или отключения нет.
        expect(m.tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(true);
        expect(m.tx.execute.mock.calls.some(([sql]) => sql.includes('WHERE TYPE_ID = 2'))).toBe(false);

        // Следующий импорт обязан проверить новый состав каталога, даже при нулевом остатке.
        m.products.listAllOfferIds.mockResolvedValue(['sku-1', 'sku-2']);
        m.products.infoList.mockResolvedValue([
            { sku: 'sku-1', typeId: 1, fbsCount: 0, fboCount: 0 },
            { sku: 'sku-2', typeId: 2, fbsCount: 0, fboCount: 0 },
        ]);
        m.tx.execute.mockClear();
        m.tx.commit.mockClear();
        await expect(m.service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
            '2 «Блинница электрическая»',
        );
        expect(m.products.listAllOfferIds).toHaveBeenCalledTimes(2);
        expect(m.tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(false);
        expect(m.tx.commit).not.toHaveBeenCalled();
        expect(m.tx.rollback).toHaveBeenCalledWith(true);
    });

    it.each(['нет в справочнике', 'отключён', 'нет в дереве'])(
        'тип своего товара %s — импорт заблокирован',
        async (reason) => {
            const m = make();
            if (reason === 'нет в справочнике')
                m.tx.query.mockImplementation(async (sql) =>
                    sql.includes('SELECT KIND FROM') ? [{ KIND: 'commissions' }] : [],
                );
            if (reason === 'отключён')
                m.tx.query.mockImplementation(async (sql) =>
                    sql.includes('SELECT KIND FROM')
                        ? [{ KIND: 'commissions' }]
                        : [{ TYPE_ID: 1, TYPE_NAME: 'Светоотражатель', CATEGORY_PATH: '', DISABLED: 1 }],
                );
            if (reason === 'нет в дереве')
                m.api.method.mockResolvedValue({ result: [{ type_id: 99, type_name: 'Другой тип' }] });
            await expect(m.service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
                'типов товаров кабинета',
            );
            expect(m.tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(false);
            expect(m.tx.commit).not.toHaveBeenCalled();
            expect(m.tx.rollback).toHaveBeenCalledWith(true);
        },
    );

    it.each([false, true])(
        'неоднозначный тариф: предупреждение для чужого типа, ошибка для своего: %s',
        async (own) => {
            const m = make();
            m.api.method.mockResolvedValue({
                result: [
                    ...currentTree.result,
                    { category_name: 'Другой путь', children: [{ type_id: 2, type_name: 'Светоотражатель' }] },
                ],
            });
            m.tx.query.mockImplementation(async (sql) =>
                sql.includes('SELECT KIND FROM')
                    ? [{ KIND: 'commissions' }]
                    : [
                          {
                              TYPE_ID: 1,
                              TYPE_NAME: 'Светоотражатель',
                              CATEGORY_PATH: 'Автотовары -> Автоаксессуары -> Светоотражатель',
                          },
                          { TYPE_ID: 2, TYPE_NAME: 'Светоотражатель', CATEGORY_PATH: 'Другой путь' },
                      ],
            );
            if (own) m.products.infoList.mockResolvedValue([{ sku: 'sku-1', typeId: 2, fbsCount: 0, fboCount: 0 }]);
            const promise = m.service.importCommissions(await commissions({ duplicate: true }), commissionName);
            if (own) {
                await expect(promise).rejects.toThrow('Неоднозначная комиссия');
                expect(m.tx.commit).not.toHaveBeenCalled();
            } else {
                expect(await promise).toMatchObject({
                    updated: 1,
                    missingCount: 1,
                    missingTypes: [{ id: 2, name: 'Светоотражатель' }],
                });
                expect(m.tx.commit).toHaveBeenCalledWith(true);
            }
        },
    );

    it.each(
        [
            undefined,
            [],
            [{ sku: 'other', typeId: 1 }],
            [{ sku: 'sku-1' }],
            [{ sku: 'sku-1', typeId: 0 }],
            [{ sku: 'sku-1', typeId: NaN }],
            [
                { sku: 'sku-1', typeId: 1 },
                { sku: 'sku-1', typeId: 1 },
            ],
        ].map((cards) => [cards]),
    )('неполные или некорректные карточки не разрешают замену тарифов: %j', async (cards) => {
        const m = make();
        m.products.infoList.mockResolvedValue(cards as any);
        await expect(m.service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
            'Не удалось проверить все товары',
        );
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });

    it.each([[], ['sku-1', 'sku-1'], ['']].map((offers) => [offers]))(
        'пустой или неоднозначный список %j не считается отсутствием своих товаров',
        async (offers) => {
            const m = make();
            m.products.listAllOfferIds.mockResolvedValue(offers);
            await expect(m.service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
                'Не удалось проверить все товары',
            );
            expect(m.pool.getTransaction).not.toHaveBeenCalled();
        },
    );

    it.each(['listAllOfferIds', 'infoList'] as const)('ошибка API %s сохраняет старые тарифы', async (method) => {
        const m = make();
        m.products[method].mockRejectedValue(new Error('API unavailable'));
        await expect(m.service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
            'Прежние тарифы сохранены',
        );
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });

    it('проверяет все карточки пачками 100/1, включая последний товар', async () => {
        const m = make();
        const offers = Array.from({ length: 101 }, (_, i) => `sku-${i}`);
        m.products.listAllOfferIds.mockResolvedValue(offers);
        m.products.infoList.mockImplementation(async (batch) =>
            batch.map((sku) => ({ sku, typeId: 1, fbsCount: 0, fboCount: 0 })),
        );
        expect((await m.service.importCommissions(await commissions(), commissionName)).updated).toBe(1);
        expect(m.products.infoList.mock.calls).toEqual([[offers.slice(0, 100)], [offers.slice(100)]]);
        m.products.infoList.mockImplementation(async (batch) =>
            batch.map((sku) => ({ sku, typeId: sku === 'sku-100' ? 2 : 1, fbsCount: 0, fboCount: 0 })),
        );
        m.tx.execute.mockClear();
        m.tx.commit.mockClear();
        await expect(m.service.importCommissions(await commissions(), commissionName)).rejects.toThrow(
            'типов товаров кабинета: 2',
        );
        expect(m.tx.commit).not.toHaveBeenCalled();
        expect(m.tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(false);
    });

    it('недоступное дерево Ozon не приводит к очистке комиссий', async () => {
        const { pool, service, api } = make();
        api.method.mockResolvedValue({ result: null });
        await expect(service.importCommissions(await commissions(), commissionName)).rejects.toThrow('дерево');
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });

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
        const { tx, service, api } = make();
        api.method.mockResolvedValue({
            result: [{ category_name: 'Другая категория', children: [{ type_id: 1, type_name: 'Светоотражатель' }] }],
        });
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

describe('Чтение действующей логистики из Firebird', () => {
    const make = () => {
        let hash = 'v1';
        let amount = 21;
        const query = jest.fn(async (sql: string) =>
            sql.includes('SELECT FILE_HASH')
                ? [{ FILE_HASH: hash }]
                : [
                      {
                          VOLUME_FROM: 0,
                          VOLUME_TO: 1,
                          ORIGIN_CLUSTER: 'Новосибирск ',
                          DESTINATION_CLUSTER: 'Москва ',
                          IS_DEFAULT: 0,
                          PRICE_FROM: 0,
                          PRICE_FROM_INCLUDED: 1,
                          PRICE_TO: 300,
                          PRICE_TO_INCLUDED: 1,
                          AMOUNT: amount,
                      },
                  ],
        );
        const tx = { query, rollback: jest.fn().mockResolvedValue(undefined), commit: jest.fn(), execute: jest.fn() };
        const pool = { getTransaction: jest.fn().mockResolvedValue(tx) };
        const service = new OzonTariffService(pool as any, {} as any, {} as any, {} as any);
        return {
            service,
            tx,
            pool,
            change: (revision: string, value = 21) => {
                hash = revision;
                amount = value;
            },
        };
    };
    it('округляет объём вверх до миллилитра, читает диапазон и завершает без записи', async () => {
        const m = make();
        const result = await m.service.logistics(0.20001);
        expect(m.tx.query).toHaveBeenCalledWith(expect.stringContaining('VOLUME_FROM <= ?'), [0.201, 0.201], false);
        expect(result).toMatchObject({
            loaded: true,
            revision: 'v1',
            rows: [
                {
                    origin: 'Новосибирск',
                    destination: 'Москва',
                    amount: 21,
                    band: { min: 0, max: 300, minIncluded: true, maxIncluded: true },
                },
            ],
        });
        const { ISOLATION_READ_COMMITTED_READ_ONLY } = await import('ts-firebird');
        expect(m.pool.getTransaction).toHaveBeenCalledWith(ISOLATION_READ_COMMITTED_READ_ONLY);
        expect(m.tx.rollback).toHaveBeenCalledWith(true);
        expect(m.tx.commit).not.toHaveBeenCalled();
        expect(m.tx.execute).not.toHaveBeenCalled();
    });
    it('кэш привязан к версии файла; новый импорт сразу меняет цену', async () => {
        const m = make();
        await m.service.logistics(0.2);
        await m.service.logistics(0.2);
        expect(m.tx.query.mock.calls.filter(([sql]) => sql.includes('VOLUME_FROM <= ?'))).toHaveLength(1);
        m.change('v2', 50);
        expect((await m.service.logistics(0.2)).rows[0].amount).toBe(50);
        expect(m.tx.query.mock.calls.filter(([sql]) => sql.includes('VOLUME_FROM <= ?'))).toHaveLength(2);
    });
    it('импорт во время чтения не выдаёт смесь версий', async () => {
        const m = make();
        m.tx.query
            .mockResolvedValueOnce([{ FILE_HASH: 'v1' }] as any)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ FILE_HASH: 'v2' }] as any);
        await expect(m.service.logistics(1)).rejects.toThrow('изменились');
        expect(m.tx.rollback).toHaveBeenCalledWith(true);
        expect((await m.service.logistics(1)).rows).toHaveLength(1);
    });
    it('нет импорта или таблицы — явный признак для API max; ошибка связи не маскируется', async () => {
        const m = make();
        m.change('');
        expect(await m.service.logistics(1)).toEqual({ loaded: false, revision: null, rows: [] });
        m.tx.query.mockRejectedValueOnce(new Error('Table unknown OZON_LOGISTICS_TARIFF'));
        expect((await m.service.logistics(1)).loaded).toBe(false);
        m.tx.query.mockRejectedValueOnce(new Error('connection lost'));
        await expect(m.service.logistics(1)).rejects.toThrow('connection lost');
        expect(m.tx.rollback).toHaveBeenCalledTimes(3);
    });
    it.each([0, -1, NaN, Infinity])('не читает тарифы для неверного объёма %s', async (volume) => {
        const m = make();
        await expect(m.service.logistics(volume)).rejects.toThrow('объём');
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });
});
