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
import { OzonApiService } from '../ozon.api/ozon.api.service';

describe('OzonCategoryService', () => {
    let service: OzonCategoryService;
    let getCategoryAttributes: jest.Mock;
    let getCategoryAttributeValues: jest.Mock;

    beforeEach(async () => {
        getCategoryAttributes = jest.fn();
        getCategoryAttributeValues = jest.fn();

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
                { provide: AIService, useValue: {} },
                { provide: FIREBIRD, useValue: {} },
                { provide: Cache, useValue: { get: jest.fn(), set: jest.fn() } },
                { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(20) } },
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
});
