import { ResolvePackagingCommand } from './resolve-packaging.command';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { makeInput, makeVariant } from './test-helpers';

describe('ResolvePackagingCommand', () => {
    const command = new ResolvePackagingCommand();

    it('should auto-select packaging when no packages specified', async () => {
        const context: IProductCreateContext = {
            input: makeInput(),
            variants: [makeVariant()],
        };
        const result = await command.execute(context);
        // Товар 100×150×50 → Пакет 100×150
        expect(result.variants![0].depth).toBe(150);
        expect(result.variants![0].width).toBe(100);
        expect(result.variants![0].height).toBe(50);
        expect(result.variants![0].weightWithPackaging).toBe(710);
        expect(result.variants![0].packagingName).toBe('Пакет 100×150');
    });

    it('should apply manual dimensions from packages array', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ packages: [[200, 200, 100]] }),
            variants: [makeVariant()],
        };
        const result = await command.execute(context);
        expect(result.variants![0].depth).toBe(200);
        expect(result.variants![0].width).toBe(200);
        expect(result.variants![0].height).toBe(100);
    });

    it('should auto-select packaging when pkg=1', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ packages: [1] }),
            variants: [makeVariant()],
        };
        const result = await command.execute(context);
        // Товар 100×150×50 → пакет 100×150, height=50
        expect(result.variants![0].depth).toBe(150);
        expect(result.variants![0].width).toBe(100);
        expect(result.variants![0].height).toBe(50);
        expect(result.variants![0].packagingName).toBe('Пакет 100×150');
    });

    it('should auto-select for batch with pkg=1', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ packages: [1] }),
            variants: [makeVariant({ qty: 10 })],
        };
        const result = await command.execute(context);
        // 10 шт товара 100×150×50 — автоподбор
        expect(result.variants![0].packagingName).toBeDefined();
    });

    it('should handle mixed: auto + manual in same batch', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ packages: [1, [300, 300, 200]] }),
            variants: [makeVariant({ qty: 1 }), makeVariant({ qty: 50, offerId: '123-50' })],
        };
        const result = await command.execute(context);
        // Первый — автоподбор
        expect(result.variants![0].packagingName).toBeDefined();
        // Второй — ручные размеры
        expect(result.variants![1].depth).toBe(300);
        expect(result.variants![1].width).toBe(300);
        expect(result.variants![1].height).toBe(200);
        expect(result.variants![1].packagingName).toBeUndefined();
    });
});
