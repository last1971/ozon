import { BuildProductJsonCommand } from './build-product-json.command';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { makeInput, makeVariant } from './test-helpers';

describe('BuildProductJsonCommand', () => {
    it('should build product_json with correct structure', async () => {
        const configService = { get: jest.fn().mockReturnValue(22) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            description_category_id: 123,
            type_id: 456,
            description: 'Описание',
            hashtags: 'тест, товар',
            resolved_attributes: [{ id: 85, complex_id: 0, values: [{ value: 'Brand' }] }],
            variants: [makeVariant()],
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
        const context: IProductCreateContext = {
            input: makeInput(),
            variants: [makeVariant()],
        };

        const result = await command.execute(context);
        expect(result.product_json.items[0].vat).toBe('0.05');
    });

    it('should format hashtags: add # prefix, replace spaces with _', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            hashtags: 'блок питания, din рейка, 12 вольт',
            variants: [makeVariant()],
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
            variants: [makeVariant()],
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
            variants: [makeVariant()],
        };

        const result = await command.execute(context);
        const ids = result.product_json.items[0].attributes.map((a: any) => a.id);
        expect(ids).toEqual([4191, 4383, 8513, 23171, 23249, 23518]);
    });

    it('should map multiple variants to multiple items', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            variants: [
                makeVariant({ qty: 1, offerId: '123', name: 'Конденсатор, 1 шт', depth: 150, width: 100, height: 50 }),
                makeVariant({ qty: 10, offerId: '123-10', name: 'Конденсатор, 10 шт', depth: 300, width: 200, height: 100, weightWithPackaging: 7100, weightWithoutPackaging: 7000 }),
                makeVariant({ qty: 50, offerId: '123-50', name: 'Конденсатор, 50 шт', depth: 200, width: 200, height: 100, weightWithPackaging: 40000, weightWithoutPackaging: 35000 }),
            ],
        };

        const result = await command.execute(context);
        const items = result.product_json.items;

        expect(items).toHaveLength(3);

        expect(items[0].name).toBe('Конденсатор, 1 шт');
        expect(items[0].offer_id).toBe('123');
        expect(items[0].depth).toBe(150);

        expect(items[1].name).toBe('Конденсатор, 10 шт');
        expect(items[1].offer_id).toBe('123-10');
        expect(items[1].weight).toBe(7100);

        expect(items[2].name).toBe('Конденсатор, 50 шт');
        expect(items[2].offer_id).toBe('123-50');
        expect(items[2].depth).toBe(200);
    });

    it('should set weight attribute 4383 from variant.weightWithoutPackaging', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            variants: [
                makeVariant({ qty: 1, weightWithoutPackaging: 700 }),
                makeVariant({ qty: 10, weightWithoutPackaging: 7000 }),
            ],
        };

        const result = await command.execute(context);
        const w1 = result.product_json.items[0].attributes.find((a: any) => a.id === 4383);
        const w10 = result.product_json.items[1].attributes.find((a: any) => a.id === 4383);
        expect(w1.values[0].value).toBe('700');
        expect(w10.values[0].value).toBe('7000');
    });

    it('should set attribute 8513 (quantity in package) per variant', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            variants: [
                makeVariant({ qty: 1 }),
                makeVariant({ qty: 5 }),
                makeVariant({ qty: 10 }),
            ],
        };

        const result = await command.execute(context);
        const getQty8513 = (item: any) => item.attributes.find((a: any) => a.id === 8513).values[0].value;
        expect(getQty8513(result.product_json.items[0])).toBe('1');
        expect(getQty8513(result.product_json.items[1])).toBe('5');
        expect(getQty8513(result.product_json.items[2])).toBe('10');
    });

    it('should set attribute 23249 (quantity in package) to qty value', async () => {
        const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
        const command = new BuildProductJsonCommand(configService);
        const context: IProductCreateContext = {
            input: makeInput(),
            variants: [
                makeVariant({ qty: 1 }),
                makeVariant({ qty: 10 }),
                makeVariant({ qty: 50 }),
            ],
        };

        const result = await command.execute(context);
        const getQty = (item: any) => item.attributes.find((a: any) => a.id === 23249).values[0].value;
        expect(getQty(result.product_json.items[0])).toBe('1');
        expect(getQty(result.product_json.items[1])).toBe('10');
        expect(getQty(result.product_json.items[2])).toBe('50');
    });
});
