import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FIREBIRD } from '../firebird/firebird.module';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { TnvedSyncService } from './tnved-sync.service';

describe('TnvedSyncService', () => {
    let service: TnvedSyncService;
    const query = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const method = jest.fn();
    const pool = { getTransaction: jest.fn().mockResolvedValue({ query, commit, rollback }) };

    beforeEach(async () => {
        query.mockReset();
        commit.mockReset();
        rollback.mockReset();
        method.mockReset();
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                TnvedSyncService,
                { provide: FIREBIRD, useValue: pool },
                { provide: OzonApiService, useValue: { method } },
                { provide: ConfigService, useValue: { get: (_k: string, def: number) => def } },
            ],
        }).compile();
        service = moduleRef.get(TnvedSyncService);
    });

    // Ozon-карточка с указанным текущим ТНВЭД (или без атрибута ТНВЭД)
    const productAttrs = (offer: string, tnved: string | null) => ({
        offer_id: offer,
        id: 999,
        name: `PROD-${offer}`,
        description_category_id: 42872319,
        type_id: 99309,
        attributes: tnved ? [{ id: 22232, values: [{ value: `${tnved} - Что-то там` }] }] : [],
    });

    /**
     * Диспетчер моков Ozon по пути.
     * @param offers список offer_id, которые «есть» на Озоне (для /v3/product/list)
     * @param attrs  map offer_id -> текущий ТНВЭД карточки
     * @param search результат values/search
     */
    const mockOzon = (
        offers: string[],
        attrs: Record<string, string | null>,
        search: any[] = [],
        update: any = { task_id: 5221013431 },
    ) => {
        method.mockImplementation((path: string, body: any) => {
            if (path === '/v3/product/list')
                return Promise.resolve({ result: { items: offers.map((o) => ({ offer_id: o })), last_id: '' } });
            if (path === '/v4/product/info/attributes') {
                const o = body.filter.offer_id[0];
                return Promise.resolve({ result: o in attrs ? [productAttrs(o, attrs[o])] : [] });
            }
            if (path === '/v1/description-category/attribute/values/search') return Promise.resolve({ result: search });
            if (path === '/v1/product/attributes/update') return Promise.resolve(update);
            return Promise.resolve({});
        });
    };

    const MARK = [
        { id: 972997562, value: '8504409100 - МАРКИРОВКА РФ - Преобразователи' },
        { id: 971399915, value: '8504409100 - Преобразователи' },
    ];

    it('ТНВЭД отличается → toFix с dictValueId «МАРКИРОВКА РФ», без записи (dry-run)', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 568651, TNVED: '8504409100' }]);
        mockOzon(['568651'], { '568651': '8504408500' }, MARK);

        const rep = await service.sync({ apply: false });

        expect(rep.checkedGoods).toBe(1);
        expect(rep.checkedOffers).toBe(1);
        expect(rep.toFix).toHaveLength(1);
        expect(rep.toFix[0]).toMatchObject({
            offer: '568651',
            goodscode: '568651',
            ozon: '8504408500',
            base: '8504409100',
            dictValueId: 972997562,
        });
        expect(method).not.toHaveBeenCalledWith('/v1/product/attributes/update', expect.anything());
    });

    it('суффиксные варианты (531557 и 531557-10) — правятся ОБА', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 531557, TNVED: '8504409100' }]);
        mockOzon(['531557', '531557-10', '999999'], { '531557': '8504408500', '531557-10': null }, MARK);

        const rep = await service.sync({ apply: false });

        expect(rep.checkedOffers).toBe(2); // обе карточки товара 531557
        expect(rep.toFix.map((f) => f.offer).sort()).toEqual(['531557', '531557-10']);
        expect(rep.notFoundOnOzon).toHaveLength(0);
    });

    it('ТНВЭД совпадает → alreadyOk', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 111, TNVED: '8504409100' }]);
        mockOzon(['111'], { '111': '8504409100' }, MARK);

        const rep = await service.sync({ apply: false });

        expect(rep.alreadyOk).toBe(1);
        expect(rep.toFix).toHaveLength(0);
    });

    it('на Озоне нет ни одной карточки товара → notFoundOnOzon', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 222, TNVED: '8504409100' }]);
        mockOzon(['777', '888'], {}, MARK); // среди offer'ов нет goodscode 222

        const rep = await service.sync({ apply: false });

        expect(rep.notFoundOnOzon).toEqual(['222']);
        expect(rep.checkedOffers).toBe(0);
        expect(rep.toFix).toHaveLength(0);
    });

    it('нет варианта «МАРКИРОВКА РФ» → ambiguous', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 333, TNVED: '8541410008' }]);
        mockOzon(['333'], { '333': '8504408500' }, [{ id: 1, value: '8541410008 - Светодиоды (без маркировки)' }]);

        const rep = await service.sync({ apply: false });

        expect(rep.toFix).toHaveLength(0);
        expect(rep.ambiguous).toHaveLength(1);
        expect(rep.ambiguous[0].offer).toBe('333');
    });

    it('apply=true → зовёт attributes/update с ТНВЭД+маркировкой и возвращает task_id', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 568651, TNVED: '8504409100' }]);
        mockOzon(['568651'], { '568651': '8504408500' }, MARK);

        const rep = await service.sync({ apply: true });

        expect(rep.toFix[0].taskId).toBe(5221013431);
        expect(method).toHaveBeenCalledWith('/v1/product/attributes/update', {
            items: [
                {
                    offer_id: '568651',
                    attributes: [
                        { id: 22232, values: [{ dictionary_value_id: 972997562 }] },
                        { id: 23536, values: [{ value: 'true' }] },
                    ],
                },
            ],
        });
    });
});
