import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FIREBIRD } from '../firebird/firebird.module';
import { ProductService } from '../product/product.service';
import { TnvedSyncService } from './tnved-sync.service';

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
    const productService = { list, getProductAttributes, searchCategoryAttributeValues, updateAttributes };

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
        [query, commit, rollback, list, getProductAttributes, searchCategoryAttributeValues, updateAttributes].forEach(
            (m) => m.mockReset(),
        );
        searchCategoryAttributeValues.mockResolvedValue(MARK_VALUES);
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                TnvedSyncService,
                { provide: FIREBIRD, useValue: pool },
                { provide: ProductService, useValue: productService },
                { provide: ConfigService, useValue: { get: (_k: string, def: number) => def } },
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

            const rep = await service.sync({ apply: false });

            expect(rep.alreadyOk).toBe(0);
            expect(rep.toFix).toHaveLength(1);
            expect(rep.toFix[0]).toMatchObject({ offer: '568615', dictValueId: MARK_ID, markRequired: true });
            expect(rep.toFix[0].reason).toContain('МАРКИРОВКА РФ');
            expect(rep.toFix[0].reason).toContain('включить код маркировки');
        });

        it('нужный вариант «МАРКИРОВКА РФ» + чекбокс вкл → alreadyOk', async () => {
            query.mockResolvedValueOnce([baseRow(111, '8504409100')]);
            ozonCatalog(['111'], { '111': { code: '8504409100', dictId: MARK_ID, markOn: true } });

            const rep = await service.sync({ apply: false });

            expect(rep.alreadyOk).toBe(1);
            expect(rep.toFix).toHaveLength(0);
        });

        it('нужный вариант, но чекбокс ВЫКЛ → toFix', async () => {
            query.mockResolvedValueOnce([baseRow(112, '8504409100')]);
            ozonCatalog(['112'], { '112': { code: '8504409100', dictId: MARK_ID, markOn: false } });

            const rep = await service.sync({ apply: false });

            expect(rep.toFix).toHaveLength(1);
            expect(rep.toFix[0].reason).toContain('включить код маркировки');
        });

        it('другой ТНВЭД → toFix', async () => {
            query.mockResolvedValueOnce([baseRow(568651, '8504409100')]);
            ozonCatalog(['568651'], { '568651': { code: '8504408500', dictId: 971399914, markOn: false } });

            const rep = await service.sync({ apply: false });

            expect(rep.toFix[0]).toMatchObject({ offer: '568651', ozon: '8504408500', base: '8504409100', dictValueId: MARK_ID });
            expect(updateAttributes).not.toHaveBeenCalled();
        });

        it('нет варианта «МАРКИРОВКА РФ» → ambiguous', async () => {
            query.mockResolvedValueOnce([baseRow(333, '8541410008')]);
            ozonCatalog(['333'], { '333': { code: '8504408500', dictId: 1, markOn: false } });
            searchCategoryAttributeValues.mockResolvedValue([{ id: 1, value: '8541410008 - Светодиоды (без маркировки)' }]);

            const rep = await service.sync({ apply: false });

            expect(rep.toFix).toHaveLength(0);
            expect(rep.ambiguous[0].offer).toBe('333');
            expect(rep.ambiguous[0].reason).toContain('МАРКИРОВКА РФ');
        });

        it('apply=true → updateAttributes с вариантом МАРКИРОВКА РФ + чекбокс true, возвращает task_id', async () => {
            query.mockResolvedValueOnce([baseRow(568615, '8504409100')]);
            ozonCatalog(['568615'], { '568615': { code: '8504409100', dictId: PLAIN_ID, markOn: false } });
            updateAttributes.mockResolvedValue([{ task_id: 5221013431 }]);

            const rep = await service.sync({ apply: true });

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

            const rep = await service.sync({ apply: false });

            expect(rep.alreadyOk).toBe(1);
            expect(rep.toFix).toHaveLength(0);
        });

        it('стоит вариант МАРКИРОВКА РФ + чекбокс ВКЛ → toFix (плоский + снять крыжик)', async () => {
            query.mockResolvedValueOnce([baseRow(558060, '8504409100', 0)]);
            ozonCatalog(['558060'], { '558060': { code: '8504409100', dictId: MARK_ID, markOn: true } });

            const rep = await service.sync({ apply: false });

            expect(rep.toFix).toHaveLength(1);
            expect(rep.toFix[0]).toMatchObject({ offer: '558060', dictValueId: PLAIN_ID, markRequired: false });
            expect(rep.toFix[0].reason).toContain('без маркировки');
            expect(rep.toFix[0].reason).toContain('выключить код маркировки');
        });

        it('apply=true → updateAttributes плоский вариант + чекбокс false', async () => {
            query.mockResolvedValueOnce([baseRow(558060, '8504409100', 0)]);
            ozonCatalog(['558060'], { '558060': { code: '8504409100', dictId: MARK_ID, markOn: true } });
            updateAttributes.mockResolvedValue([{ task_id: 7777 }]);

            const rep = await service.sync({ apply: true });

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

            const rep = await service.sync({ apply: false });

            expect(rep.checkedOffers).toBe(2);
            expect(rep.toFix.map((f) => f.offer).sort()).toEqual(['531557', '531557-10']);
        });

        it('на Озоне нет ни одной карточки товара → notFoundOnOzon', async () => {
            query.mockResolvedValueOnce([baseRow(222, '8504409100')]);
            ozonCatalog(['777', '888'], {});

            const rep = await service.sync({ apply: false });

            expect(rep.notFoundOnOzon).toEqual(['222']);
            expect(rep.checkedOffers).toBe(0);
        });
    });
});
