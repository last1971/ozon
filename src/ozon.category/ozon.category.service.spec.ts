import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OzonCategoryService } from './ozon.category.service';
import { ProductService } from '../product/product.service';
import { AIService } from '../ai/ai.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { Cache } from '@nestjs/cache-manager';
import { GenerateNameCommand } from './commands/generate-name.command';
import { FindCategoryCommand } from './commands/find-category.command';
import { LoadRequiredAttributesCommand } from './commands/load-required-attributes.command';
import { GenerateAttributeValuesCommand } from './commands/generate-attribute-values.command';
import { ResolveDictionaryValuesCommand } from './commands/resolve-dictionary-values.command';
import { ExpandVariantsCommand } from './commands/expand-variants.command';
import { ResolvePackagingCommand } from './commands/resolve-packaging.command';
import { BuildProductJsonCommand } from './commands/build-product-json.command';
import { SubmitProductCommand } from './commands/submit-product.command';
import { ValidateOfferIdCommand } from './commands/validate-offer-id.command';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { HierarchicalNSW } from 'hnswlib-node';

describe('OzonCategoryService', () => {
    let service: OzonCategoryService;
    let getCategoryAttributes: jest.Mock;
    let getCategoryAttributeValues: jest.Mock;
    let cacheGet: jest.Mock;
    let cacheSet: jest.Mock;
    let generateEmbedding: jest.Mock;
    let poolQuery: jest.Mock;
    let poolCommit: jest.Mock;
    let poolRollback: jest.Mock;

    beforeEach(async () => {
        getCategoryAttributes = jest.fn();
        getCategoryAttributeValues = jest.fn();
        cacheGet = jest.fn().mockResolvedValue(null);
        cacheSet = jest.fn().mockResolvedValue(undefined);
        generateEmbedding = jest.fn();
        poolQuery = jest.fn().mockResolvedValue([]);
        poolCommit = jest.fn().mockResolvedValue(undefined);
        poolRollback = jest.fn().mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OzonCategoryService,
                {
                    provide: ProductService,
                    useValue: {
                        getCategoryTree: jest.fn(),
                        getCategoryAttributes,
                        getCategoryAttributeValues,
                    },
                },
                {
                    provide: AIService,
                    useValue: {
                        generateEmbedding,
                        generateEmbeddings: jest.fn(),
                    },
                },
                {
                    provide: FIREBIRD,
                    useValue: {
                        getTransaction: jest.fn().mockResolvedValue({
                            query: poolQuery,
                            execute: jest.fn(),
                            commit: poolCommit,
                            rollback: poolRollback,
                            transaction: {},
                        }),
                    },
                },
                { provide: Cache, useValue: { get: cacheGet, set: cacheSet } },
                { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(20) } },
                { provide: ValidateOfferIdCommand, useValue: {} },
                { provide: GenerateNameCommand, useValue: {} },
                { provide: FindCategoryCommand, useValue: {} },
                { provide: LoadRequiredAttributesCommand, useValue: {} },
                { provide: GenerateAttributeValuesCommand, useValue: {} },
                { provide: ResolveDictionaryValuesCommand, useValue: {} },
                { provide: ExpandVariantsCommand, useValue: {} },
                { provide: ResolvePackagingCommand, useValue: {} },
                { provide: BuildProductJsonCommand, useValue: {} },
                { provide: SubmitProductCommand, useValue: {} },
                { provide: OzonApiService, useValue: { method: jest.fn() } },
            ],
        }).compile();

        service = module.get<OzonCategoryService>(OzonCategoryService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ========== getCategoryAttributes ==========

    it('getCategoryAttributes filters skipped attributes', async () => {
        getCategoryAttributes.mockResolvedValue({
            result: [
                { id: 85, name: 'Бренд', dictionary_id: 123 },
                { id: 4180, name: 'Название', dictionary_id: 0 },  // skip
                { id: 4191, name: 'Аннотация', dictionary_id: 0 },
                { id: 8789, name: 'PDF файл', dictionary_id: 0 },  // skip
            ],
        });
        getCategoryAttributeValues.mockResolvedValue([
            { id: 1, value: 'Nike', info: '', picture: '' },
        ]);

        const result = await service.getCategoryAttributes(53884411, 971025231);

        expect(result.description_category_id).toBe(53884411);
        expect(result.type_id).toBe(971025231);
        expect(result.attributes).toHaveLength(2);
        expect(result.attributes.map(a => a.id)).toEqual([85, 4191]);
    });

    it('getCategoryAttributes loads dictionary values only for dictionary_id > 0', async () => {
        getCategoryAttributes.mockResolvedValue({
            result: [
                { id: 85, name: 'Бренд', dictionary_id: 100 },
                { id: 4191, name: 'Аннотация', dictionary_id: 0 },
            ],
        });
        getCategoryAttributeValues.mockResolvedValue([
            { id: 1, value: 'TestBrand', info: '', picture: '' },
        ]);

        const result = await service.getCategoryAttributes(1, 2);

        expect(getCategoryAttributeValues).toHaveBeenCalledTimes(1);
        expect(getCategoryAttributeValues).toHaveBeenCalledWith(85, 1, 2);
        expect(result.attributes[0].values).toHaveLength(1);
        expect(result.attributes[1].values).toEqual([]);
    });

    it('getCategoryAttributes handles empty result', async () => {
        getCategoryAttributes.mockResolvedValue({ result: [] });

        const result = await service.getCategoryAttributes(1, 2);

        expect(result.attributes).toEqual([]);
        expect(getCategoryAttributeValues).not.toHaveBeenCalled();
    });

    it('getCategoryAttributes handles null result', async () => {
        getCategoryAttributes.mockResolvedValue({});

        const result = await service.getCategoryAttributes(1, 2);

        expect(result.attributes).toEqual([]);
    });

    // ========== searchByVector (через searchSimilar) ==========

    it('searchSimilar returns [] when no index and rebuild fails', async () => {
        cacheGet.mockResolvedValue(null);
        const result = await service.searchSimilar('test', 5);
        expect(result).toEqual([]);
    });

    it('searchSimilar calls generateEmbedding and searchKnn', async () => {
        const mockEmbedding = new Array(1536).fill(0.1);
        generateEmbedding.mockResolvedValue(mockEmbedding);

        const mockIndex = {
            getCurrentCount: jest.fn().mockReturnValue(10),
            searchKnn: jest.fn().mockReturnValue({
                neighbors: [0, 1],
                distances: [0.1, 0.3],
            }),
        } as unknown as HierarchicalNSW;

        // Inject mock index and maps
        (service as any).index = mockIndex;
        (service as any).typeIdMap = new Map([[0, 100], [1, 200]]);
        (service as any).typeDataMap = new Map([
            [100, { name: 'Тип1', path: 'Путь -> Тип1' }],
            [200, { name: 'Тип2', path: 'Путь -> Тип2' }],
        ]);

        // Mock getCommissions
        poolQuery.mockResolvedValue([]);

        const result = await service.searchSimilar('блоки питания', 2);

        expect(generateEmbedding).toHaveBeenCalledWith('блоки питания');
        expect(mockIndex.searchKnn).toHaveBeenCalledWith(mockEmbedding, 2);
        expect(result).toHaveLength(2);
        expect(result[0].typeId).toBe(100);
        expect(result[0].typeName).toBe('Тип1');
        expect(result[0].categoryPath).toBe('Путь -> Тип1');
        expect(result[0].similarity).toBeCloseTo(0.9);
        expect(result[1].typeId).toBe(200);
        expect(result[1].similarity).toBeCloseTo(0.7);
    });

    // ========== findByPath ==========

    it('findByPath finds by exact path', async () => {
        (service as any).typeDataMap = new Map([
            [100, { name: 'Блоки питания', path: 'Электроника -> Блоки питания' }],
        ]);
        poolQuery.mockResolvedValue([]);

        const result = await service.findByPath('Электроника > Блоки питания');

        expect(result).not.toBeNull();
        expect(result!.typeId).toBe(100);
        expect(result!.similarity).toBe(1);
    });

    it('findByPath falls back to last segment match', async () => {
        (service as any).typeDataMap = new Map([
            [100, { name: 'Блоки питания', path: 'Электроника -> Источники питания -> Блоки питания' }],
        ]);
        poolQuery.mockResolvedValue([]);

        const result = await service.findByPath('Другой путь > Блоки питания');

        expect(result).not.toBeNull();
        expect(result!.typeId).toBe(100);
    });

    it('findByPath returns null when nothing matches', async () => {
        (service as any).typeDataMap = new Map([
            [100, { name: 'Блоки питания', path: 'Электроника -> Блоки питания' }],
        ]);

        const result = await service.findByPath('Не существует');

        expect(result).toBeNull();
    });

    // ========== WB search ==========

    it('searchWbCategory returns [] when no WB index and rebuild fails', async () => {
        cacheGet.mockResolvedValue(null);
        const result = await service.searchWbCategory('test', 5);
        expect(result).toEqual([]);
    });

    it('searchWbCategory calls generateEmbedding and returns mapped results', async () => {
        const mockEmbedding = new Array(1536).fill(0.2);
        generateEmbedding.mockResolvedValue(mockEmbedding);

        const mockIndex = {
            getCurrentCount: jest.fn().mockReturnValue(10),
            searchKnn: jest.fn().mockReturnValue({
                neighbors: [0, 1],
                distances: [0.05, 0.2],
            }),
        } as unknown as HierarchicalNSW;

        (service as any).wbIndex = mockIndex;
        (service as any).wbIdMap = new Map([[0, 2009], [1, 3001]]);
        (service as any).wbDataMap = new Map([
            [2009, { name: 'Блоки питания', parentName: 'Электрика' }],
            [3001, { name: 'Адаптеры', parentName: 'Электроника' }],
        ]);

        const result = await service.searchWbCategory('блоки питания', 2);

        expect(generateEmbedding).toHaveBeenCalledWith('блоки питания');
        expect(result).toHaveLength(2);
        expect(result[0].subjectID).toBe(2009);
        expect(result[0].name).toBe('Блоки питания');
        expect(result[0].parentName).toBe('Электрика');
        expect(result[0].similarity).toBeCloseTo(0.95);
        expect(result[1].subjectID).toBe(3001);
    });

    // ========== searchWbByOzonType ==========

    it('searchWbByOzonType uses ozon embedding vector from Redis', async () => {
        const mockVector = new Array(1536).fill(0.5);
        const buf = Buffer.from(new Float32Array(mockVector).buffer);
        const embBase64 = buf.toString('base64');

        cacheGet.mockImplementation(async (key: string) => {
            if (key === 'ozon:emb:99309') {
                return JSON.stringify({ name: 'Электронный модуль', path: 'Электроника -> Электронный модуль', emb: embBase64 });
            }
            return null;
        });

        const mockIndex = {
            getCurrentCount: jest.fn().mockReturnValue(10),
            searchKnn: jest.fn().mockReturnValue({
                neighbors: [0],
                distances: [0.1],
            }),
        } as unknown as HierarchicalNSW;

        (service as any).wbIndex = mockIndex;
        (service as any).wbIdMap = new Map([[0, 2009]]);
        (service as any).wbDataMap = new Map([
            [2009, { name: 'Блоки питания', parentName: 'Электрика' }],
        ]);

        const result = await service.searchWbByOzonType(99309, 1);

        expect(cacheGet).toHaveBeenCalledWith('ozon:emb:99309');
        expect(mockIndex.searchKnn).toHaveBeenCalled();
        const passedVector = (mockIndex.searchKnn as jest.Mock).mock.calls[0][0];
        expect(passedVector).toHaveLength(1536);
        expect(result).toHaveLength(1);
        expect(result[0].subjectID).toBe(2009);
    });

    it('searchWbByOzonType throws when no ozon embedding in Redis', async () => {
        cacheGet.mockResolvedValue(null);

        const mockIndex = {
            getCurrentCount: jest.fn().mockReturnValue(10),
        } as unknown as HierarchicalNSW;
        (service as any).wbIndex = mockIndex;

        await expect(service.searchWbByOzonType(99999, 5)).rejects.toThrow('No Ozon embedding for type_id=99999');
    });

    // ========== mapWbHits ==========

    it('mapWbHits handles missing data in wbDataMap', () => {
        (service as any).wbDataMap = new Map();
        const hits = [{ id: 999, similarity: 0.8 }];
        const result = (service as any).mapWbHits(hits);

        expect(result).toHaveLength(1);
        expect(result[0].subjectID).toBe(999);
        expect(result[0].name).toBe('');
        expect(result[0].parentName).toBe('');
    });

    // ========== buildSearchResult ==========

    it('buildSearchResult returns correct structure with commissions', async () => {
        poolQuery.mockResolvedValue([{
            FBO_COMMISSIONS: null,
            FBS_COMMISSIONS: null,
        }]);

        const data = { name: 'TestType', path: 'Cat -> TestType' };
        const result = await (service as any).buildSearchResult(123, data, 0.95);

        expect(result.typeId).toBe(123);
        expect(result.typeName).toBe('TestType');
        expect(result.categoryPath).toBe('Cat -> TestType');
        expect(result.similarity).toBe(0.95);
    });

    it('buildSearchResult defaults similarity to 1', async () => {
        poolQuery.mockResolvedValue([]);

        const result = await (service as any).buildSearchResult(123, { name: 'T', path: 'P' });
        expect(result.similarity).toBe(1);
    });
});
