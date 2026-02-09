import { CreateProductInput, ProductVariant } from '../interfaces/product-create.context';

export const makeInput = (overrides: Partial<CreateProductInput> = {}): CreateProductInput =>
    ({
        text: 'Блок питания',
        offer_id: '123',
        package_depth: 100,
        package_width: 150,
        package_height: 50,
        weight_with_packaging: 800,
        weight_without_packaging: 700,
        images: ['https://example.com/img.jpg'],
        ...overrides,
    }) as CreateProductInput;

export const makeVariant = (overrides: Partial<ProductVariant> = {}): ProductVariant => ({
    qty: 1,
    offerId: '123',
    name: 'Тестовый товар',
    depth: 100,
    width: 150,
    height: 50,
    weightWithPackaging: 800,
    weightWithoutPackaging: 700,
    ...overrides,
});
