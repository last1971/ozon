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

    it('should use findByPath when category_path is provided', async () => {
        const pathResult = { typeId: 42, typeName: 'Конденсаторы', categoryPath: 'Электроника -> Компоненты -> Конденсаторы', similarity: 1, fbsCommission: 0.1 };
        const ozonCategoryService = { findByPath: jest.fn().mockResolvedValue(pathResult), searchSimilar: jest.fn() } as any;
        const pool = makePool([{ CATEGORY_ID: 555 }]);
        const command = new FindCategoryCommand(ozonCategoryService, pool as any);
        const context: IProductCreateContext = {
            input: { text: 'test', category_path: 'Электроника > Компоненты > Конденсаторы' } as CreateProductInput,
            generated_name: 'Test',
        };

        const result = await command.execute(context);

        expect(ozonCategoryService.findByPath).toHaveBeenCalledWith('Электроника > Компоненты > Конденсаторы');
        expect(ozonCategoryService.searchSimilar).not.toHaveBeenCalled();
        expect(result.type_id).toBe(42);
        expect(result.description_category_id).toBe(555);
    });

    it('should fallback to HNSW when findByPath returns null', async () => {
        const hnswResult = { typeId: 7, typeName: 'X', categoryPath: 'X', similarity: 0.9, fbsCommission: 0.05 };
        const ozonCategoryService = { findByPath: jest.fn().mockResolvedValue(null), searchSimilar: jest.fn().mockResolvedValue([hnswResult]) } as any;
        const pool = makePool([{ CATEGORY_ID: 777 }]);
        const command = new FindCategoryCommand(ozonCategoryService, pool as any);
        const context: IProductCreateContext = {
            input: { text: 'test', category_path: 'Несуществующий > Путь' } as CreateProductInput,
            generated_name: 'Test',
        };

        const result = await command.execute(context);

        expect(ozonCategoryService.findByPath).toHaveBeenCalledWith('Несуществующий > Путь');
        expect(ozonCategoryService.searchSimilar).toHaveBeenCalledWith('Test', 5);
        expect(result.type_id).toBe(7);
        expect(result.description_category_id).toBe(777);
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
