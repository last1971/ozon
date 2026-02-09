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
    { name: 'Коробка 80×70×50', type: 'box', length: 80, width: 70, height: 50, weight: 16 },
    { name: 'Коробка 180×90×100', type: 'box', length: 180, width: 90, height: 100, weight: 38 },
    { name: 'Коробка 190×140×80', type: 'box', length: 190, width: 140, height: 80, weight: 60 },
    { name: 'Коробка 195×145×145', type: 'box', length: 195, width: 145, height: 145, weight: 80 },
    { name: 'Коробка 260×180×320', type: 'box', length: 260, width: 180, height: 320, weight: 300 },
    { name: 'Коробка 420×320×175', type: 'box', length: 420, width: 320, height: 175, weight: 600 },
    { name: 'Коробка 590×390×410', type: 'box', length: 590, width: 390, height: 410, weight: 700 },
    { name: 'Коробка 790×590×410', type: 'box', length: 790, width: 590, height: 410, weight: 1200 },
];
