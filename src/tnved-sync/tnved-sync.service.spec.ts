import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FIREBIRD } from '../firebird/firebird.module';
import { ProductService } from '../product/product.service';
import { TnvedSyncService } from './tnved-sync.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { LoadBaseTnvedCommand } from './commands/load-base-tnved.command';
import { SkipProcessedCommand } from './commands/skip-processed.command';
import { CheckTnvedCommand } from './commands/check-tnved.command';
import { BuildTnvedReportCommand } from './commands/build-tnved-report.command';
import { UpdateTnvedCommand } from './commands/update-tnved.command';
import { MarkProcessedCommand } from './commands/mark-processed.command';
import { JobService } from '../job/job.service';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';

describe('TnvedSyncService', () => {
    let service: TnvedSyncService;
    const query = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const pool = { getTransaction: jest.fn().mockResolvedValue({ query, commit, rollback }) };

    const list = jest.fn();
    const getProductAttributes = jest.fn();
    const searchCategoryAttributeValues = jest.fn();
    const updateAttributes = jest.fn();
    const evictProductAttributes = jest.fn();
    const productService = { list, getProductAttributes, searchCategoryAttributeValues, updateAttributes, evictProductAttributes };
    const progressLoad = jest.fn();
    const progressSave = jest.fn();
    const progressClear = jest.fn();

    // id значений словаря ТНВЭД 8504409100 в категории
    const MARK_ID = 972997562; // «8504409100 - МАРКИРОВКА РФ»
    const PLAIN_ID = 971399915; // «8504409100 - Преобразователи» (без маркировки)
    const MARK_VALUES = [
        { id: MARK_ID, value: '8504409100 - МАРКИРОВКА РФ - Преобразователи' },
        { id: PLAIN_ID, value: '8504409100 - Преобразователи' },
    ];

    // строка выборки базы: GOODSCODE + ТНВЭД + флаг маркируемости (MR=1 по умолчанию)
    const baseRow = (gc: number, tnved: string, markRequired = 1) => ({
        GOODSCODE: gc,
        TNVED: tnved,
        MARK_REQUIRED: markRequired,
    });

    beforeEach(async () => {
        [query, commit, rollback, list, getProductAttributes, searchCategoryAttributeValues, updateAttributes, evictProductAttributes, progressLoad, progressSave, progressClear].forEach(
            (m) => m.mockReset(),
        );
        progressLoad.mockResolvedValue(new Set<string>());
        searchCategoryAttributeValues.mockResolvedValue(MARK_VALUES);
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                TnvedSyncService,
                OzonTnvedService,
                LoadBaseTnvedCommand,
                SkipProcessedCommand,
                CheckTnvedCommand,
                BuildTnvedReportCommand,
                UpdateTnvedCommand,
                MarkProcessedCommand,
                JobService,
                { provide: WbTnvedService, useValue: {} },
                { provide: ProcessedCacheService, useValue: { load: progressLoad, save: progressSave, clear: progressClear } },
                { provide: FIREBIRD, useValue: pool },
                { provide: ProductService, useValue: productService },
                { provide: ConfigService, useValue: { get: (k: string, def: any) => (k === 'SERVICES' ? ['ozon'] : def) } },
            ],
        }).compile();
        service = moduleRef.get(TnvedSyncService);
    });

    // карточка Озона: code — цифры ТНВЭД, dictId — id варианта словаря, markOn — чекбокс «Нужен код маркировки»
    const card = (offer: string, d: { code?: string | null; dictId?: number | null; markOn?: boolean } = {}) => ({
        offer_id: offer,
        id: 999,
        name: `PROD-${offer}`,
        description_category_id: 42872319,
        type_id: 99309,
        attributes: [
            { id: 22232, values: [{ dictionary_value_id: d.dictId ?? null, value: `${d.code ?? ''} - x` }] },
            { id: 23536, values: [{ value: d.markOn ? 'true' : 'false' }] },
        ],
    });

    const ozonCatalog = (offers: string[], cards: Record<string, Parameters<typeof card>[1]>) => {
        list.mockResolvedValue({ result: { items: offers.map((o) => ({ offer_id: o })), last_id: '' } });
        getProductAttributes.mockImplementation((o: string) => Promise.resolve(o in cards ? card(o, cards[o]) : null));
    };

    describe('маркируемый (MARK_REQUIRED=1)', () => {
        it('правильный код, но ПЛОСКИЙ вариант + чекбокс выкл → toFix (кейс со скрина HDR-100-24)', async () => {
            query.mockResolvedValueOnce([baseRow(568615, '8504409100')]);
            ozonCatalog(['568615'], { '568615': { code: '8504409100', dictId: PLAIN_ID, markOn: false } });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.alreadyOk).toBe(0);
            expect(rep.toFix).toHaveLength(1);
            expect(rep.toFix[0]).toMatchObject({ offer: '568615', dictValueId: MARK_ID, markRequired: true });
            expect(rep.toFix[0].reason).toContain('МАРКИРОВКА РФ');
            expect(rep.toFix[0].reason).toContain('включить код маркировки');
        });

        it('нужный вариант «МАРКИРОВКА РФ» + чекбокс вкл → alreadyOk', async () => {
            query.mockResolvedValueOnce([baseRow(111, '8504409100')]);
            ozonCatalog(['111'], { '111': { code: '8504409100', dictId: MARK_ID, markOn: true } });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.alreadyOk).toBe(1);
            expect(rep.toFix).toHaveLength(0);
        });

        it('нужный вариант, но чекбокс ВЫКЛ → toFix', async () => {
            query.mockResolvedValueOnce([baseRow(112, '8504409100')]);
            ozonCatalog(['112'], { '112': { code: '8504409100', dictId: MARK_ID, markOn: false } });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.toFix).toHaveLength(1);
            expect(rep.toFix[0].reason).toContain('включить код маркировки');
        });

        it('другой ТНВЭД → toFix', async () => {
            query.mockResolvedValueOnce([baseRow(568651, '8504409100')]);
            ozonCatalog(['568651'], { '568651': { code: '8504408500', dictId: 971399914, markOn: false } });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.toFix[0]).toMatchObject({ offer: '568651', current: '8504408500', base: '8504409100', dictValueId: MARK_ID });
            expect(updateAttributes).not.toHaveBeenCalled();
        });

        it('нет варианта «МАРКИРОВКА РФ», текущий из дублей → alreadyOk, дубль не перетираем (565831)', async () => {
            query.mockResolvedValueOnce([baseRow(565831, '8504408300')]);
            ozonCatalog(['565831'], { '565831': { code: '8504408300', dictId: 972997561, markOn: true } });
            searchCategoryAttributeValues.mockResolvedValue([
                { id: 971399913, value: '8504408300 - Выпрямители прочие' },
                { id: 972997561, value: '8504408300 - Выпрямители прочие.' },
            ]);

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.alreadyOk).toBe(1);
            expect(rep.toFix).toHaveLength(0);
            expect(rep.ambiguous).toHaveLength(0);
        });

        it('кода нет в категории → ambiguous «не поддерживается»', async () => {
            query.mockResolvedValueOnce([baseRow(333, '8541410008')]);
            ozonCatalog(['333'], { '333': { code: '8504408500', dictId: 1, markOn: false } });
            searchCategoryAttributeValues.mockResolvedValue([]);

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.toFix).toHaveLength(0);
            expect(rep.ambiguous[0].offer).toBe('333');
            expect(rep.ambiguous[0].reason).toContain('не поддерживается');
        });

        it('apply=true → updateAttributes с вариантом МАРКИРОВКА РФ + чекбокс true, возвращает task_id', async () => {
            query.mockResolvedValueOnce([baseRow(568615, '8504409100')]);
            ozonCatalog(['568615'], { '568615': { code: '8504409100', dictId: PLAIN_ID, markOn: false } });
            updateAttributes.mockResolvedValue([{ task_id: 5221013431 }]);

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: true });

            expect(rep.toFix[0].taskId).toBe(5221013431);
            expect(updateAttributes).toHaveBeenCalledWith({
                offer_ids: ['568615'],
                attributes: [
                    { complex_id: 0, id: 22232, values: [{ dictionary_value_id: MARK_ID }] },
                    { complex_id: 0, id: 23536, values: [{ value: 'true' }] },
                ],
            });
        });
    });

    describe('немаркируемый (MARK_REQUIRED=0)', () => {
        it('плоский вариант + чекбокс ВЫКЛ → alreadyOk', async () => {
            query.mockResolvedValueOnce([baseRow(558060, '8504409100', 0)]);
            ozonCatalog(['558060'], { '558060': { code: '8504409100', dictId: PLAIN_ID, markOn: false } });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.alreadyOk).toBe(1);
            expect(rep.toFix).toHaveLength(0);
        });

        it('стоит вариант МАРКИРОВКА РФ + чекбокс ВКЛ → toFix (плоский + снять крыжик)', async () => {
            query.mockResolvedValueOnce([baseRow(558060, '8504409100', 0)]);
            ozonCatalog(['558060'], { '558060': { code: '8504409100', dictId: MARK_ID, markOn: true } });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.toFix).toHaveLength(1);
            expect(rep.toFix[0]).toMatchObject({ offer: '558060', dictValueId: PLAIN_ID, markRequired: false });
            expect(rep.toFix[0].reason).toContain('без маркировки');
            expect(rep.toFix[0].reason).toContain('выключить код маркировки');
        });

        it('apply=true → updateAttributes плоский вариант + чекбокс false', async () => {
            query.mockResolvedValueOnce([baseRow(558060, '8504409100', 0)]);
            ozonCatalog(['558060'], { '558060': { code: '8504409100', dictId: MARK_ID, markOn: true } });
            updateAttributes.mockResolvedValue([{ task_id: 7777 }]);

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: true });

            expect(rep.toFix[0].taskId).toBe(7777);
            expect(updateAttributes).toHaveBeenCalledWith({
                offer_ids: ['558060'],
                attributes: [
                    { complex_id: 0, id: 22232, values: [{ dictionary_value_id: PLAIN_ID }] },
                    { complex_id: 0, id: 23536, values: [{ value: 'false' }] },
                ],
            });
        });
    });

    describe('общие', () => {
        it('суффиксные варианты (531557 и 531557-10) — оба в toFix', async () => {
            query.mockResolvedValueOnce([baseRow(531557, '8504409100')]);
            ozonCatalog(['531557', '531557-10', '999999'], {
                '531557': { code: '8504408500', dictId: 971399914, markOn: false },
                '531557-10': { code: null, dictId: null, markOn: false },
            });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.checkedOffers).toBe(2);
            expect(rep.toFix.map((f) => f.offer).sort()).toEqual(['531557', '531557-10']);
        });

        it('на Озоне нет ни одной карточки товара → notFoundOnOzon', async () => {
            query.mockResolvedValueOnce([baseRow(222, '8504409100')]);
            ozonCatalog(['777', '888'], {});

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: false });

            expect(rep.notFoundOnOzon).toEqual(['222']);
            expect(rep.checkedOffers).toBe(0);
        });
    });

    describe('прогресс раскатки (ProcessedCacheService)', () => {
        it('onlyNew: обработанные товары пропускаются, limit — по необработанным', async () => {
            query.mockResolvedValueOnce([baseRow(1, '8504409100'), baseRow(2, '8504409100'), baseRow(3, '8504409100')]);
            progressLoad.mockResolvedValue(new Set(['1']));
            ozonCatalog(['2', '3'], {
                '2': { code: '8504409100', dictId: MARK_ID, markOn: true },
                '3': { code: '8504409100', dictId: MARK_ID, markOn: true },
            });

            const rep = await service.sync({ market: GoodServiceEnum.OZON, onlyNew: true, limit: 1 });

            expect(rep.checkedGoods).toBe(1);
            expect(rep.skippedProcessed).toBe(1);
            expect(rep.remaining).toBe(2); // 2 и 3 — dry-run ничего не помечает
            expect(getProductAttributes).toHaveBeenCalledTimes(1);
            expect(getProductAttributes).toHaveBeenCalledWith('2');
            expect(progressSave).not.toHaveBeenCalled();
        });

        it('apply: помечаются товары, где всё ок/записано; спорные, с ошибкой и без карточки — нет', async () => {
            query.mockResolvedValueOnce([
                baseRow(10, '8504409100'), // уже ок
                baseRow(11, '8504409100'), // запишем
                baseRow(12, '8541410008'), // спорный: кода нет в категории
                baseRow(13, '8504409100'), // нет карточки
            ]);
            ozonCatalog(['10', '11', '12'], {
                '10': { code: '8504409100', dictId: MARK_ID, markOn: true },
                '11': { code: '8504409100', dictId: PLAIN_ID, markOn: false },
                '12': { code: '8504408500', dictId: 1, markOn: false },
            });
            searchCategoryAttributeValues.mockImplementation((_a: number, _c: number, _t: number, q: string) =>
                Promise.resolve(q === '8504409100' ? MARK_VALUES : []),
            );
            updateAttributes.mockResolvedValue([{ task_id: 7 }]);

            const rep = await service.sync({ market: GoodServiceEnum.OZON, apply: true, onlyNew: true });

            expect(progressSave).toHaveBeenCalledTimes(1);
            const [name, scope, set] = progressSave.mock.calls[0];
            expect([name, scope]).toEqual(['tnved', 'ozon']);
            expect(Array.from(set as Set<string>).sort()).toEqual(['10', '11']);
            expect(rep.remaining).toBe(2);
        });

        it('clearProgress → clear в кэше по маркетплейсу', async () => {
            await service.clearProgress(GoodServiceEnum.WB);

            expect(progressClear).toHaveBeenCalledWith('tnved', 'wb');
        });
    });
});
