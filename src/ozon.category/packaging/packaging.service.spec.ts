import { findPackaging, findPackagingForBatch } from './packaging.service';

describe('findPackaging', () => {
    it('should select smallest bag for small product', () => {
        const result = findPackaging({ depth: 30, width: 50, height: 10, weight: 50 });
        expect(result).not.toBeNull();
        expect(result!.packaging.type).toBe('bag');
        expect(result!.packaging.name).toBe('Пакет 100×150');
        // Пакет: depth=length пакета, width=width пакета, height=наименьший размер товара
        expect(result!.packageDepth).toBe(150);
        expect(result!.packageWidth).toBe(100);
        expect(result!.packageHeight).toBe(10);
        expect(result!.weightWithPackaging).toBe(60); // 50 + 10
    });

    it('should consider rotation — product fits when rotated', () => {
        // Товар 80×80×10 — два больших размера 80,80 влезают в пакет 100×150
        const result = findPackaging({ depth: 80, width: 10, height: 80, weight: 100 });
        expect(result).not.toBeNull();
        expect(result!.packaging.name).toBe('Пакет 100×150');
        expect(result!.packageHeight).toBe(10); // наименьший размер
    });

    it('should select larger bag when product does not fit in smallest', () => {
        // Товар 180×200×20 — не влезает в пакеты < 190×240
        const result = findPackaging({ depth: 180, width: 200, height: 20, weight: 300 });
        expect(result).not.toBeNull();
        expect(result!.packaging.name).toBe('Пакет 190×240');
    });

    it('should select box when product is too thick for bags', () => {
        // Товар 60×60×40 — два больших = 60,60 влезают в пакет 100×150,
        // но коробка 80×70×50 тоже подходит. Пакет предпочтительнее.
        const result = findPackaging({ depth: 60, width: 60, height: 40, weight: 200 });
        expect(result).not.toBeNull();
        expect(result!.packaging.type).toBe('bag');
        expect(result!.packaging.name).toBe('Пакет 100×150');
    });

    it('should prefer bag over box when both fit', () => {
        // Товар 60×60×40 — sorted [40,60,60], влезает и в пакет 100×150 и в коробку 80×70×50
        const result = findPackaging({ depth: 60, width: 60, height: 40, weight: 200 });
        expect(result).not.toBeNull();
        expect(result!.packaging.type).toBe('bag');
    });

    it('should return null when product does not fit anything', () => {
        const result = findPackaging({ depth: 700, width: 500, height: 500, weight: 10000 });
        expect(result).toBeNull();
    });
});

describe('findPackagingForBatch', () => {
    it('should delegate to findPackaging for qty=1', () => {
        const result = findPackagingForBatch({ depth: 30, width: 50, height: 10, weight: 50 }, 1);
        expect(result).not.toBeNull();
        expect(result!.packaging.name).toBe('Пакет 100×150');
    });

    it('should select bag for small batch stacked flat', () => {
        // 3 шт товара 30×50×10, стопка высотой 10*3=30
        // Пакет 100×150: 50<=100, 30<=150 — влезает, stackHeight=30<=50 — ok
        // Но коробка 70×70×50 vol=245000, bag vol=100*150*30=450000 — коробка меньше
        // Используем товар покрупнее: 90×140×5, пакет 100×150 → 90<=100,140<=150
        // стопка 5*3=15, 15<=100/2=50 → ok, vol=100*150*15=225000
        // коробка 70×70×50: sorted=[5,90,140], box=[50,70,70] → 5<=50 ok, 90<=70 FAIL — не влезает
        const result = findPackagingForBatch({ depth: 90, width: 140, height: 5, weight: 50 }, 3);
        expect(result).not.toBeNull();
        expect(result!.packaging.type).toBe('bag');
        expect(result!.packaging.name).toBe('Пакет 100×150');
        expect(result!.packageHeight).toBe(15); // стопка 5*3
        expect(result!.weightWithPackaging).toBe(160); // 50*3 + 10
    });

    it('should select box for larger batch', () => {
        // 100 шт товара 30×50×10, volume=15000*100=1500000, /0.65=2307692
        // Коробка 195×145×145 vol=4098375 — наименьшая подходящая (80г)
        const result = findPackagingForBatch({ depth: 30, width: 50, height: 10, weight: 50 }, 100);
        expect(result).not.toBeNull();
        expect(result!.packaging.type).toBe('box');
        expect(result!.packaging.name).toBe('Коробка 195×145×145');
        expect(result!.weightWithPackaging).toBe(5080); // 50*100 + 80
    });

    it('should return null when batch does not fit anything', () => {
        const result = findPackagingForBatch({ depth: 200, width: 200, height: 200, weight: 5000 }, 50);
        // 50 шт по 8000000мм³ = 400000000, /0.65 ≈ 615M — не влезает
        expect(result).toBeNull();
    });
});
