export type PackageType = 'bag' | 'box';

export interface PackagingOption {
    name: string;
    type: PackageType;
    length: number;  // мм
    width: number;   // мм
    height?: number; // мм (только для box)
    weight: number;  // г (вес тары)
}

export const PACKAGING_OPTIONS: PackagingOption[] = [
    // Пакеты (отсортированы по площади)
    { name: 'Пакет 100×150', type: 'bag', length: 150, width: 100, weight: 10 },
    { name: 'Пакет 110×210', type: 'bag', length: 210, width: 110, weight: 10 },
    { name: 'Пакет 120×240', type: 'bag', length: 240, width: 120, weight: 10 },
    { name: 'Пакет 170×240', type: 'bag', length: 240, width: 170, weight: 10 },
    { name: 'Пакет 190×240', type: 'bag', length: 240, width: 190, weight: 10 },
    { name: 'Пакет 240×320', type: 'bag', length: 320, width: 240, weight: 10 },
    { name: 'Пакет 300×400', type: 'bag', length: 400, width: 300, weight: 10 },
    { name: 'Пакет 400×500', type: 'bag', length: 500, width: 400, weight: 10 },
    { name: 'Пакет 500×600', type: 'bag', length: 600, width: 500, weight: 10 },
    // Коробки (отсортированы по объёму)
    { name: 'Коробка 70×70×50', type: 'box', length: 70, width: 70, height: 50, weight: 10 },
    { name: 'Коробка 600×400×400', type: 'box', length: 600, width: 400, height: 400, weight: 100 },
];
