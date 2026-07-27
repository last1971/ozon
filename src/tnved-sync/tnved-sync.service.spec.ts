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
        attributes: tnved
            ? [{ id: 22232, values: [{ value: `${tnved} - Что-то там` }] }]
            : [],
    });

    it('ТНВЭД отличается → попадает в toFix с dictValueId варианта «МАРКИРОВКА РФ», без записи (dry-run)', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 568651, TNVED: '8504409100' }]);
        method.mockImplementation((path: string) => {
            if (path === '/v4/product/info/attributes') return Promise.resolve({ result: [productAttrs('568651', '8504408500')] });
            if (path === '/v1/description-category/attribute/values/search')
                return Promise.resolve({ result: [
                    { id: 972997562, value: '8504409100 - МАРКИРОВКА РФ - Преобразователи' },
                    { id: 971399915, value: '8504409100 - Преобразователи' },
                ] });
            return Promise.resolve({});
        });

        const rep = await service.sync({ apply: false });

        expect(rep.checked).toBe(1);
        expect(rep.alreadyOk).toBe(0);
        expect(rep.toFix).toHaveLength(1);
        expect(rep.toFix[0]).toMatchObject({ offer: '568651', ozon: '8504408500', base: '8504409100', dictValueId: 972997562 });
        // dry-run: attributes/update НЕ вызывался
        expect(method).not.toHaveBeenCalledWith('/v1/product/attributes/update', expect.anything());
    });

    it('ТНВЭД совпадает → alreadyOk, не в toFix', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 111, TNVED: '8504409100' }]);
        method.mockResolvedValueOnce({ result: [productAttrs('111', '8504409100')] });

        const rep = await service.sync({ apply: false });

        expect(rep.alreadyOk).toBe(1);
        expect(rep.toFix).toHaveLength(0);
    });

    it('товара нет на Озоне → notFoundOnOzon', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 222, TNVED: '8504409100' }]);
        method.mockResolvedValueOnce({ result: [] });

        const rep = await service.sync({ apply: false });

        expect(rep.notFoundOnOzon).toEqual(['222']);
        expect(rep.toFix).toHaveLength(0);
    });

    it('нет варианта «МАРКИРОВКА РФ» → ambiguous', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 333, TNVED: '8541410008' }]);
        method.mockImplementation((path: string) => {
            if (path === '/v4/product/info/attributes') return Promise.resolve({ result: [productAttrs('333', '8504408500')] });
            if (path === '/v1/description-category/attribute/values/search')
                return Promise.resolve({ result: [{ id: 1, value: '8541410008 - Светодиоды (без маркировки)' }] });
            return Promise.resolve({});
        });

        const rep = await service.sync({ apply: false });

        expect(rep.toFix).toHaveLength(0);
        expect(rep.ambiguous).toHaveLength(1);
        expect(rep.ambiguous[0].offer).toBe('333');
    });

    it('apply=true → зовёт attributes/update с ТНВЭД+маркировкой и возвращает task_id', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 568651, TNVED: '8504409100' }]);
        method.mockImplementation((path: string, body: any) => {
            if (path === '/v4/product/info/attributes') return Promise.resolve({ result: [productAttrs('568651', '8504408500')] });
            if (path === '/v1/description-category/attribute/values/search')
                return Promise.resolve({ result: [{ id: 972997562, value: '8504409100 - МАРКИРОВКА РФ - Преобразователи' }] });
            if (path === '/v1/product/attributes/update') return Promise.resolve({ task_id: 5221013431 });
            return Promise.resolve({});
        });

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
