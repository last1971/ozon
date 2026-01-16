import { GenericProductCoeffsAdapter } from './generic.product.coeffs.adapter';

describe('GenericProductCoeffsAdapter', () => {
    it('should return sku', () => {
        const adapter = new GenericProductCoeffsAdapter('12345-2');
        expect(adapter.getSku()).toBe('12345-2');
    });

    it('should return 0 for salesPercent', () => {
        const adapter = new GenericProductCoeffsAdapter('12345');
        expect(adapter.getSalesPercent()).toBe(0);
    });

    it('should return 0 for transMaxAmount', () => {
        const adapter = new GenericProductCoeffsAdapter('12345');
        expect(adapter.getTransMaxAmount()).toBe(0);
    });
});
