import { ResolveDictionaryValuesCommand } from './resolve-dictionary-values.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

describe('ResolveDictionaryValuesCommand', () => {
    it('should use dictionary_value_id when already provided by AI', async () => {
        const productService = { getCategoryAttributeValues: jest.fn() } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 85, value: 'Nike', dictionary_value_id: 123 }],
            required_attributes: [{ id: 85, name: 'Бренд', dictionary_id: 100 }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes).toHaveLength(1);
        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBe(123);
        expect(productService.getCategoryAttributeValues).not.toHaveBeenCalled();
    });

    it('should search in large dictionary when values_count > 0', async () => {
        const productService = {
            getCategoryAttributeValues: jest.fn().mockResolvedValue([
                { id: 456, value: 'Samsung' },
                { id: 789, value: 'LG' },
            ]),
        } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 85, value: 'samsung' }],
            required_attributes: [{ id: 85, name: 'Бренд', dictionary_id: 100, values_count: 5000 }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBe(456);
        expect(result.resolved_attributes![0].values[0].value).toBe('Samsung');
    });

    it('should match via includes: "тайвань" → "Китай (Тайвань)"', async () => {
        const productService = {
            getCategoryAttributeValues: jest.fn().mockResolvedValue([
                { id: 90317, value: 'Китай (Тайвань)' },
                { id: 90318, value: 'Китай' },
            ]),
        } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 4389, value: 'Тайвань' }],
            required_attributes: [{ id: 4389, name: 'Страна', dictionary_id: 100, values_count: 500 }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBe(90317);
        expect(result.resolved_attributes![0].values[0].value).toBe('Китай (Тайвань)');
    });

    it('should match via reverseIncludes: "Защита от перегрева" → "перегрев"', async () => {
        const productService = {
            getCategoryAttributeValues: jest.fn().mockResolvedValue([
                { id: 100, value: 'перегрев' },
                { id: 200, value: 'короткое замыкание' },
            ]),
        } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 55, value: 'Защита от перегрева' }],
            required_attributes: [{ id: 55, name: 'Защита', dictionary_id: 10, values_count: 100 }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBe(100);
        expect(result.resolved_attributes![0].values[0].value).toBe('перегрев');
    });

    it('should fallback to text when no match in large dictionary', async () => {
        const productService = {
            getCategoryAttributeValues: jest.fn().mockResolvedValue([{ id: 1, value: 'Other' }]),
        } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 85, value: 'UnknownBrand' }],
            required_attributes: [{ id: 85, name: 'Бренд', dictionary_id: 100, values_count: 500 }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBeUndefined();
        expect(result.resolved_attributes![0].values[0].value).toBe('UnknownBrand');
    });

    it('should search small dictionary from loaded values', async () => {
        const productService = { getCategoryAttributeValues: jest.fn() } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 85, value: 'nike' }],
            required_attributes: [{
                id: 85, name: 'Бренд', dictionary_id: 100,
                values: [{ id: 10, value: 'Nike' }, { id: 20, value: 'Adidas' }],
            }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBe(10);
        expect(productService.getCategoryAttributeValues).not.toHaveBeenCalled();
    });

    it('should fallback to text in small dictionary when no match', async () => {
        const productService = { getCategoryAttributeValues: jest.fn() } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 85, value: 'Винтовые клеммы' }],
            required_attributes: [{
                id: 85, name: 'Коннектор', dictionary_id: 100,
                values: [{ id: 10, value: '3 Hole' }, { id: 20, value: 'USB' }],
            }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBeUndefined();
        expect(result.resolved_attributes![0].values[0].value).toBe('Винтовые клеммы');
    });

    it('should output free text for attributes without dictionary', async () => {
        const productService = { getCategoryAttributeValues: jest.fn() } as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            ai_attributes: [{ id: 9048, value: 'NDR-75-12' }],
            required_attributes: [{ id: 9048, name: 'Модель', dictionary_id: 0 }] as any,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.resolved_attributes![0].values[0].value).toBe('NDR-75-12');
        expect(result.resolved_attributes![0].values[0].dictionary_value_id).toBeUndefined();
    });

    it('should handle empty ai_attributes', async () => {
        const productService = {} as any;
        const command = new ResolveDictionaryValuesCommand(productService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);
        expect(result.resolved_attributes).toEqual([]);
    });
});
