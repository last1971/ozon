import { FindCategoryCommand } from './find-category.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

describe('FindCategoryCommand', () => {
    const makePool = (rows: any[] = []) => ({
        getTransaction: jest.fn().mockResolvedValue({
            query: jest.fn().mockResolvedValue(rows),
            commit: jest.fn(),
            rollback: jest.fn(),
        }),
    });

    it('should set stopChain when no results', async () => {
        const ozonCategoryService = { searchSimilar: jest.fn().mockResolvedValue([]) } as any;
        const command = new FindCategoryCommand(ozonCategoryService, makePool() as any);
        const context: IProductCreateContext = {
            input: { text: 'test' } as CreateProductInput,
            generated_name: 'Test Product',
        };

        const result = await command.execute(context);
        expect(result.stopChain).toBe(true);
        expect(ozonCategoryService.searchSimilar).toHaveBeenCalledWith('Test Product', 5);
    });

    it('should pick the most relevant category (first result)', async () => {
        const results = [
            { typeId: 1, typeName: 'A', categoryPath: 'A', similarity: 0.95, fbsCommission: 0.15 },
            { typeId: 2, typeName: 'B', categoryPath: 'B', similarity: 0.90, fbsCommission: 0.05 },
            { typeId: 3, typeName: 'C', categoryPath: 'C', similarity: 0.85, fbsCommission: 0.10 },
        ];
        const ozonCategoryService = { searchSimilar: jest.fn().mockResolvedValue(results) } as any;
        const pool = makePool([{ CATEGORY_ID: 999 }]);
        const command = new FindCategoryCommand(ozonCategoryService, pool as any);
        const context: IProductCreateContext = {
            input: { text: 'test' } as CreateProductInput,
            generated_name: 'Test',
        };

        const result = await command.execute(context);

        expect(result.type_id).toBe(1);
        expect(result.fbs_commission).toBe(0.15);
        expect(result.description_category_id).toBe(999);
        expect(result.category_path).toBe('A');
    });

    it('should use input.text when generated_name is absent', async () => {
        const ozonCategoryService = { searchSimilar: jest.fn().mockResolvedValue([]) } as any;
        const command = new FindCategoryCommand(ozonCategoryService, makePool() as any);
        const context: IProductCreateContext = {
            input: { text: 'fallback text' } as CreateProductInput,
        };

        await command.execute(context);
        expect(ozonCategoryService.searchSimilar).toHaveBeenCalledWith('fallback text', 5);
    });
});
