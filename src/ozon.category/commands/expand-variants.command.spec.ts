import { ExpandVariantsCommand } from './expand-variants.command';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { makeInput } from './test-helpers';

describe('ExpandVariantsCommand', () => {
    const command = new ExpandVariantsCommand();

    it('should create single variant without suffix when no quantities', async () => {
        const context: IProductCreateContext = {
            input: makeInput(),
            generated_name: 'Тестовый товар',
        };
        const result = await command.execute(context);
        expect(result.variants).toHaveLength(1);
        expect(result.variants![0].qty).toBe(1);
        expect(result.variants![0].offerId).toBe('123');
        expect(result.variants![0].name).toBe('Тестовый товар');
        expect(result.variants![0].weightWithPackaging).toBe(800);
        expect(result.variants![0].weightWithoutPackaging).toBe(700);
    });

    it('should expand quantities with suffixes', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ quantities: [1, 10, 50] }),
            generated_name: 'Конденсатор',
        };
        const result = await command.execute(context);
        expect(result.variants).toHaveLength(3);

        expect(result.variants![0].qty).toBe(1);
        expect(result.variants![0].offerId).toBe('123');
        expect(result.variants![0].name).toBe('Конденсатор, 1 шт');

        expect(result.variants![1].qty).toBe(10);
        expect(result.variants![1].offerId).toBe('123-10');
        expect(result.variants![1].name).toBe('Конденсатор, 10 шт');
        expect(result.variants![1].weightWithPackaging).toBe(8000);
        expect(result.variants![1].weightWithoutPackaging).toBe(7000);

        expect(result.variants![2].qty).toBe(50);
        expect(result.variants![2].offerId).toBe('123-50');
        expect(result.variants![2].name).toBe('Конденсатор, 50 шт');
    });

    it('should use input.text when generated_name is absent', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ text: 'Fallback' }),
        };
        const result = await command.execute(context);
        expect(result.variants![0].name).toBe('Fallback');
    });

    it('should set initial dimensions from input', async () => {
        const context: IProductCreateContext = {
            input: makeInput({ package_depth: 200, package_width: 300, package_height: 100 }),
        };
        const result = await command.execute(context);
        expect(result.variants![0].depth).toBe(200);
        expect(result.variants![0].width).toBe(300);
        expect(result.variants![0].height).toBe(100);
    });
});
