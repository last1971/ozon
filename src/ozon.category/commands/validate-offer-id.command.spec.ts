import { ValidateOfferIdCommand } from './validate-offer-id.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

describe('ValidateOfferIdCommand', () => {
    const makeCommand = (skuList: string[]) => {
        const productService = { skuList } as any;
        return new ValidateOfferIdCommand(productService);
    };

    const makeContext = (overrides: Partial<CreateProductInput> = {}): IProductCreateContext => ({
        input: { text: 'test', offer_id: '999', images: ['https://img.jpg'], ...overrides } as CreateProductInput,
    });

    // Валидация обязательных полей
    it('should stop when text is empty', async () => {
        const command = makeCommand([]);
        const result = await command.execute(makeContext({ text: '' }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('текст');
    });

    it('should stop when offer_id is empty', async () => {
        const command = makeCommand([]);
        const result = await command.execute(makeContext({ offer_id: '' }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('артикул');
    });

    it('should stop when images are empty', async () => {
        const command = makeCommand([]);
        const result = await command.execute(makeContext({ images: [] }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('картинки');
    });

    it('should stop when images contain only empty strings', async () => {
        const command = makeCommand([]);
        const result = await command.execute(makeContext({ images: ['', '  '] }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('картинки');
    });

    // Проверка дубликатов
    it('should pass when offer_id is not in skuList', async () => {
        const command = makeCommand(['111', '222', '333']);
        const result = await command.execute(makeContext());
        expect(result.stopChain).toBeUndefined();
        expect(result.error_message).toBeUndefined();
    });

    it('should stop on exact match', async () => {
        const command = makeCommand(['123', '456']);
        const result = await command.execute(makeContext({ offer_id: '123' }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('123');
    });

    it('should stop when input base matches sku with suffix (123 vs 123-10)', async () => {
        const command = makeCommand(['123-10', '456']);
        const result = await command.execute(makeContext({ offer_id: '123' }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('123-10');
    });

    it('should stop when input with suffix matches sku base (123-50 vs 123)', async () => {
        const command = makeCommand(['123', '456']);
        const result = await command.execute(makeContext({ offer_id: '123-50' }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('123');
    });

    it('should stop when both have suffixes sharing same base (123-50 vs 123-10)', async () => {
        const command = makeCommand(['123-10', '456-20']);
        const result = await command.execute(makeContext({ offer_id: '123-50' }));
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('123-10');
    });

    it('should pass when skuList is empty', async () => {
        const command = makeCommand([]);
        const result = await command.execute(makeContext());
        expect(result.stopChain).toBeUndefined();
        expect(result.error_message).toBeUndefined();
    });
});
