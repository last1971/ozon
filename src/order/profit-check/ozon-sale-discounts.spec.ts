import { ozonWannaDiscountSkus } from './ozon-sale-discounts';
import { PostingDto } from '../../posting/dto/posting.dto';
const posting = (products: unknown): PostingDto => ({ financial_data: { products } }) as PostingDto;
it('находит WANNADISCOUNT с датой и не считает прочие акции персональной скидкой', () => {
    expect(
        ozonWannaDiscountSkus(
            posting([
                { product_id: 2538835481, actions: ['26-11', 'WANNADISCOUNT-20261107-96H', 'Округление'] },
                { product_id: 2659212195, actions: ['26-11', 'Скидка (за счет Озон)'] },
            ]),
        ),
    ).toEqual(new Set(['2538835481']));
});
it('допускает строковые SKU, повтор названия и различие регистра', () => {
    expect(
        ozonWannaDiscountSkus(
            posting([{ product_id: '2538835481', actions: [' wannadiscount-20261107-96H ', 'WANNADISCOUNT'] }]),
        ),
    ).toEqual(new Set(['2538835481']));
});
it.each([undefined, null, {}, [{ product_id: 1, actions: null }], [{ actions: ['WANNADISCOUNT-20261107'] }], [null]])(
    'без корректных сведений не придумывает причину: %j',
    (products) => {
        expect(ozonWannaDiscountSkus(posting(products)).size).toBe(0);
    },
);
it('без financial_data сохраняет совместимость со старыми заказами', () => {
    expect(ozonWannaDiscountSkus({} as PostingDto).size).toBe(0);
});
it('не принимает похожую подстроку другого названия', () => {
    expect(
        ozonWannaDiscountSkus(posting([{ product_id: 1, actions: ['NOT-WANNADISCOUNT', 'WANNADISCOUNTED'] }])).size,
    ).toBe(0);
});
