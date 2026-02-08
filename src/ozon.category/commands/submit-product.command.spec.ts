import { SubmitProductCommand } from './submit-product.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

describe('SubmitProductCommand', () => {
    it('should set stopChain when product_json is missing', async () => {
        const ozonApiService = { method: jest.fn() } as any;
        const command = new SubmitProductCommand(ozonApiService);
        const context: IProductCreateContext = { input: { text: 'x' } as CreateProductInput };

        const result = await command.execute(context);

        expect(result.stopChain).toBe(true);
        expect(ozonApiService.method).not.toHaveBeenCalled();
    });

    it('should call ozon API and set task_id', async () => {
        const ozonApiService = {
            method: jest.fn().mockResolvedValue({ result: { task_id: 12345 } }),
        } as any;
        const command = new SubmitProductCommand(ozonApiService);
        const productJson = { items: [{ name: 'Test' }] };
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            product_json: productJson,
        };

        const result = await command.execute(context);

        expect(result.task_id).toBe(12345);
        expect(ozonApiService.method).toHaveBeenCalledWith('/v3/product/import', productJson);
    });

    it('should handle null response', async () => {
        const ozonApiService = {
            method: jest.fn().mockResolvedValue(null),
        } as any;
        const command = new SubmitProductCommand(ozonApiService);
        const context: IProductCreateContext = {
            input: { text: 'x' } as CreateProductInput,
            product_json: { items: [] },
        };

        const result = await command.execute(context);
        expect(result.task_id).toBeUndefined();
    });
});
