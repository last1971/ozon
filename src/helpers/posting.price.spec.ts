import { normalizePostingPrice, normalizePostingsPrices } from './posting.price';

describe('normalizePostingPrice', () => {
    it('объект новых ручек → строка', () => {
        // /v4/posting/fbs/list и /v3/posting/fbo/list отдают цену так
        expect(normalizePostingPrice({ amount: '4099', currency: 'RUB' })).toBe('4099');
    });

    it('строка старых ручек не меняется', () => {
        expect(normalizePostingPrice('4099.0000')).toBe('4099.0000');
    });

    it('число тоже приводится', () => {
        expect(normalizePostingPrice(4099)).toBe('4099');
    });

    it('пустая цена даёт ноль, а не NaN', () => {
        // именно из-за NaN Firebird падал с -303 Conversion error from string "NaN"
        expect(normalizePostingPrice(undefined)).toBe('0');
        expect(normalizePostingPrice(null)).toBe('0');
        expect(normalizePostingPrice({})).toBe('0');
    });

    it('после нормализации parseFloat даёт число, а не NaN', () => {
        expect(parseFloat(normalizePostingPrice({ amount: '4099', currency: 'RUB' }))).toBe(4099);
    });
});

describe('normalizePostingsPrices', () => {
    it('правит цены во всех товарах всех отправлений', () => {
        const res = normalizePostingsPrices({
            postings: [
                { products: [{ price: { amount: '100', currency: 'RUB' } }, { price: '200' }] },
                { products: [{ price: { amount: '300', currency: 'RUB' } }] },
            ],
        } as any);
        expect(res.postings[0].products[0].price).toBe('100');
        expect(res.postings[0].products[1].price).toBe('200');
        expect(res.postings[1].products[0].price).toBe('300');
    });

    it('не падает на пустом ответе', () => {
        expect(() => normalizePostingsPrices({} as any)).not.toThrow();
        expect(() => normalizePostingsPrices({ postings: [{}] } as any)).not.toThrow();
    });
});
