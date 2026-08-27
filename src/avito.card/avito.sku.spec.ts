import { avitoSku } from './avito.sku';

describe('avitoSku', () => {
    it('всегда отдаёт строку — GOODSCODE в базе INTEGER, а DTO врёт про string', () => {
        const sku = avitoSku({ goodsCode: 550539 as unknown as string, coeff: 1 });

        expect(typeof sku).toBe('string');
        expect(sku).toBe('550539');
        expect(sku.includes('550539')).toBe(true); // именно это падало в MapSkusToGoodsCommand
    });

    it('к фасовке добавляет коэффициент', () => {
        expect(avitoSku({ goodsCode: 550539 as unknown as string, coeff: 3 })).toBe('550539-3');
    });
});
