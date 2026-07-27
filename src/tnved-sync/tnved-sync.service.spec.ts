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

    beforeEach(async () => {
        [query, commit, rollback, list, getProductAttributes, searchCategoryAttributeValues, updateAttributes].forEach(
            (m) => m.mockReset(),
        );
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

    const productAttrs = (offer: string, tnved: string | null) => ({
        offer_id: offer,
        id: 999,
        name: `PROD-${offer}`,
        description_category_id: 42872319,
        type_id: 99309,
        attributes: tnved ? [{ id: 22232, values: [{ value: `${tnved} - Что-то там` }] }] : [],
    });

    const MARK = [
        { id: 972997562, value: '8504409100 - МАРКИРОВКА РФ - Преобразователи' },
        { id: 971399915, value: '8504409100 - Преобразователи' },
    ];

    // Озон-каталог: список offer'ов + карта offer -> текущий ТНВЭД карточки
    const ozonCatalog = (offers: string[], attrs: Record<string, string | null>) => {
        list.mockResolvedValue({ result: { items: offers.map((o) => ({ offer_id: o })), last_id: '' } });
        getProductAttributes.mockImplementation((o: string) =>
            Promise.resolve(o in attrs ? productAttrs(o, attrs[o]) : null),
        );
    };

    it('ТНВЭД отличается → toFix с dictValueId «МАРКИРОВКА РФ», без записи (dry-run)', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 568651, TNVED: '8504409100' }]);
        ozonCatalog(['568651'], { '568651': '8504408500' });
        searchCategoryAttributeValues.mockResolvedValue(MARK);

        const rep = await service.sync({ apply: false });

        expect(rep.checkedGoods).toBe(1);
        expect(rep.checkedOffers).toBe(1);
        expect(rep.toFix[0]).toMatchObject({
            offer: '568651',
            goodscode: '568651',
            ozon: '8504408500',
            base: '8504409100',
            dictValueId: 972997562,
        });
        expect(updateAttributes).not.toHaveBeenCalled();
    });

    it('суффиксные варианты (531557 и 531557-10) — правятся ОБА', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 531557, TNVED: '8504409100' }]);
        ozonCatalog(['531557', '531557-10', '999999'], { '531557': '8504408500', '531557-10': null });
        searchCategoryAttributeValues.mockResolvedValue(MARK);

        const rep = await service.sync({ apply: false });

        expect(rep.checkedOffers).toBe(2);
        expect(rep.toFix.map((f) => f.offer).sort()).toEqual(['531557', '531557-10']);
        expect(rep.notFoundOnOzon).toHaveLength(0);
    });

    it('ТНВЭД совпадает → alreadyOk', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 111, TNVED: '8504409100' }]);
        ozonCatalog(['111'], { '111': '8504409100' });

        const rep = await service.sync({ apply: false });

        expect(rep.alreadyOk).toBe(1);
        expect(rep.toFix).toHaveLength(0);
    });

    it('на Озоне нет ни одной карточки товара → notFoundOnOzon', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 222, TNVED: '8504409100' }]);
        ozonCatalog(['777', '888'], {});

        const rep = await service.sync({ apply: false });

        expect(rep.notFoundOnOzon).toEqual(['222']);
        expect(rep.checkedOffers).toBe(0);
    });

    it('нет варианта «МАРКИРОВКА РФ» → ambiguous', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 333, TNVED: '8541410008' }]);
        ozonCatalog(['333'], { '333': '8504408500' });
        searchCategoryAttributeValues.mockResolvedValue([{ id: 1, value: '8541410008 - Светодиоды (без маркировки)' }]);

        const rep = await service.sync({ apply: false });

        expect(rep.toFix).toHaveLength(0);
        expect(rep.ambiguous[0].offer).toBe('333');
    });

    it('apply=true → зовёт updateAttributes с ТНВЭД+маркировкой и возвращает task_id', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 568651, TNVED: '8504409100' }]);
        ozonCatalog(['568651'], { '568651': '8504408500' });
        searchCategoryAttributeValues.mockResolvedValue(MARK);
        updateAttributes.mockResolvedValue([{ task_id: 5221013431 }]);

        const rep = await service.sync({ apply: true });

        expect(rep.toFix[0].taskId).toBe(5221013431);
        expect(updateAttributes).toHaveBeenCalledWith({
            offer_ids: ['568651'],
            attributes: [
                { complex_id: 0, id: 22232, values: [{ dictionary_value_id: 972997562 }] },
                { complex_id: 0, id: 23536, values: [{ value: 'true' }] },
            ],
        });
    });
});
