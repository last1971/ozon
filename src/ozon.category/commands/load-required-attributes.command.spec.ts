import { LoadRequiredAttributesCommand } from './load-required-attributes.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

describe('LoadRequiredAttributesCommand', () => {
    it('should set stopChain when no description_category_id', async () => {
        const ozonCategoryService = {} as any;
        const command = new LoadRequiredAttributesCommand(ozonCategoryService);
        const context: IProductCreateContext = { input: { text: 'x' } as CreateProductInput };

        const result = await command.execute(context);
        expect(result.stopChain).toBe(true);
    });

    it('should filter only required attributes and exclude manual IDs', async () => {
        const ozonCategoryService = {
            getCategoryAttributes: jest.fn().mockResolvedValue({
                attributes: [
                    { id: 85, name: 'Бренд', is_required: true },
                    { id: 100, name: 'Цвет', is_required: false },
                    { id: 4191, name: 'Описание', is_required: true },   // manual
                    { id: 4383, name: 'Вес', is_required: true },         // manual
                    { id: 23171, name: 'Хэштеги', is_required: true },    // manual
                    { id: 23249, name: 'Fix1', is_required: true },       // manual
                    { id: 23518, name: 'Fix2', is_required: true },       // manual
                    { id: 9048, name: 'Модель', is_required: true },
                ],
            }),
        } as any;
        const command = new LoadRequiredAttributesCommand(ozonCategoryService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);

        expect(result.required_attributes).toHaveLength(2);
        expect(result.required_attributes!.map(a => a.id)).toEqual([85, 9048]);
        expect(ozonCategoryService.getCategoryAttributes).toHaveBeenCalledWith(1, 2);
    });

    it('should handle empty attributes', async () => {
        const ozonCategoryService = {
            getCategoryAttributes: jest.fn().mockResolvedValue({ attributes: [] }),
        } as any;
        const command = new LoadRequiredAttributesCommand(ozonCategoryService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            description_category_id: 1,
            type_id: 2,
        };

        const result = await command.execute(context);
        expect(result.required_attributes).toEqual([]);
    });
});
