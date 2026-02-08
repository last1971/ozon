import { BuildProductJsonCommand } from './build-product-json.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

const makeInput = (overrides: Partial<CreateProductInput> = {}): CreateProductInput => ({
    text: 'Блок питания', offer_id: '123', package_depth: 100, package_width: 150,
    package_height: 50, weight_with_packaging: 800, weight_without_packaging: 700,
    image_url: 'https://example.com/img.jpg', ...overrides,
} as CreateProductInput);

describe('BuildProductJsonCommand', () => {
    it('should build product_json with correct structure', async () => {
        const configService = { get: jest.fn().mockReturnValue(22) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            generated_name: 'Тестовый товар',
            description_category_id: 123,
            type_id: 456,
            description: 'Описание',
            hashtags: 'тест, товар',
            resolved_attributes: [{ id: 85, complex_id: 0, values: [{ value: 'Brand' }] }],
        };

        const result = await command.execute(context);

        const item = result.product_json.items[0];
        expect(item.name).toBe('Тестовый товар');
        expect(item.offer_id).toBe('123');
        expect(item.description_category_id).toBe(123);
        expect(item.type_id).toBe(456);
        expect(item.vat).toBe('0.22');
        expect(item.weight).toBe(800);
        expect(item.depth).toBe(100);
        expect(item.dimension_unit).toBe('mm');
        expect(item.weight_unit).toBe('g');
        expect(item.currency_code).toBe('RUB');
        expect(item.images).toEqual(['https://example.com/img.jpg']);
    });

    it('should use default VAT 0.05 when VAT_RATE not set', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = { input: makeInput() };

        const result = await command.execute(context);
        expect(result.product_json.items[0].vat).toBe('0.05');
    });

    it('should format hashtags: add # prefix, replace spaces with _', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            hashtags: 'блок питания, din рейка, 12 вольт',
        };

        const result = await command.execute(context);
        const hashtagAttr = result.product_json.items[0].attributes.find((a: any) => a.id === 23171);
        expect(hashtagAttr.values[0].value).toBe('#блок_питания #din_рейка #12_вольт');
    });

    it('should replace dashes and strip special chars in hashtags', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            hashtags: 'AC-DC преобразователь, NDR-75-24',
        };

        const result = await command.execute(context);
        const hashtagAttr = result.product_json.items[0].attributes.find((a: any) => a.id === 23171);
        expect(hashtagAttr.values[0].value).toBe('#AC_DC_преобразователь #NDR_75_24');
    });

    it('should include manual attributes (description, weight, hashtags, fixed)', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            description: 'Тест описание',
            resolved_attributes: [],
        };

        const result = await command.execute(context);
        const ids = result.product_json.items[0].attributes.map((a: any) => a.id);
        expect(ids).toEqual([4191, 4383, 23171, 23249, 23518]);
    });

    it('should use input.text as name when generated_name is absent', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = { input: makeInput({ text: 'Fallback name' }) };

        const result = await command.execute(context);
        expect(result.product_json.items[0].name).toBe('Fallback name');
    });
});
