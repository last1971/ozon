import { findPackLine } from './pack-line.util';
import { PostingPackLine } from './interfaces/posting-pack-line';

const line = (offerId: string, goodscode: string, pieces: number, productId: number): PostingPackLine => ({
    offerId,
    goodscode,
    pieces,
    productId,
});

describe('findPackLine', () => {
    // Живой кейс 0135585655-0073-1: один товар двумя фасовками.
    const multipack = [line('569593-5', '569593', 5, 3322439191), line('569593-10', '569593', 10, 3322440371)];

    it('мультипаки одного товара различает по фасовке кода', () => {
        expect(findPackLine(multipack, '569593', 5).productId).toBe(3322439191);
        expect(findPackLine(multipack, '569593', 10).productId).toBe(3322440371);
    });

    it('фасовка кода не совпала ни с одним мультипаком → null (в чужой product_id не кладём)', () => {
        expect(findPackLine(multipack, '569593', 3)).toBeNull();
    });

    it('единственная позиция товара → берётся при любой фасовке кода', () => {
        const single = [line('531557', '531557', 1, 999)];
        expect(findPackLine(single, '531557', 3).productId).toBe(999);
    });

    it('артикул с -1 и код на 1 штуку — та же позиция', () => {
        const single = [line('531557-1', '531557', 1, 999)];
        expect(findPackLine(single, '531557', 1).productId).toBe(999);
    });

    it('товара нет в отправлении → null', () => {
        expect(findPackLine(multipack, 'WRONG', 1)).toBeNull();
    });
});
