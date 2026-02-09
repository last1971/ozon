import { PACKAGING_OPTIONS, PackagingOption } from './packaging.config';

export interface ProductDimensions {
    depth: number;  // мм
    width: number;  // мм
    height: number; // мм
    weight: number; // г (вес товара без упаковки)
}

export interface PackagingResult {
    packaging: PackagingOption;
    /** Размеры посылки для Ozon (мм) */
    packageDepth: number;
    packageWidth: number;
    packageHeight: number;
    /** Вес с упаковкой (г) */
    weightWithPackaging: number;
}

/**
 * Проверяет, влезает ли товар в пакет.
 * Пакет плоский: два бо́льших размера товара <= размеры пакета (с учётом поворота).
 */
function fitsInBag(sorted: number[], bag: PackagingOption): boolean {
    const bagSorted = [bag.width, bag.length].sort((a, b) => a - b);
    // sorted[1] и sorted[2] — два бо́льших размера товара
    return sorted[1] <= bagSorted[0] && sorted[2] <= bagSorted[1];
}

/**
 * Проверяет, влезает ли товар в коробку.
 * Учёт поворота: сортируем размеры товара и коробки, сравниваем поэлементно.
 */
function fitsInBox(sorted: number[], box: PackagingOption): boolean {
    const boxSorted = [box.width, box.length, box.height!].sort((a, b) => a - b);
    return sorted[0] <= boxSorted[0] && sorted[1] <= boxSorted[1] && sorted[2] <= boxSorted[2];
}

function bagVolume(bag: PackagingOption): number {
    return bag.width * bag.length;
}

function boxVolume(box: PackagingOption): number {
    return box.width * box.length * (box.height || 0);
}

/**
 * Подбирает минимальную упаковку для товара.
 * Возвращает null если ни одна упаковка не подходит.
 */
export function findPackaging(product: ProductDimensions): PackagingResult | null {
    const sorted = [product.depth, product.width, product.height].sort((a, b) => a - b);

    let bestBag: PackagingOption | null = null;
    let bestBagArea = Infinity;

    let bestBox: PackagingOption | null = null;
    let bestBoxVol = Infinity;

    for (const option of PACKAGING_OPTIONS) {
        if (option.type === 'bag') {
            if (fitsInBag(sorted, option)) {
                const area = bagVolume(option);
                if (area < bestBagArea) {
                    bestBagArea = area;
                    bestBag = option;
                }
            }
        } else {
            if (fitsInBox(sorted, option)) {
                const vol = boxVolume(option);
                if (vol < bestBoxVol) {
                    bestBoxVol = vol;
                    bestBox = option;
                }
            }
        }
    }

    // Предпочитаем пакет (дешевле, легче), иначе коробку
    if (bestBag) {
        // Пакет: размеры посылки = длина и ширина пакета, высота = наименьший размер товара
        return {
            packaging: bestBag,
            packageDepth: bestBag.length,
            packageWidth: bestBag.width,
            packageHeight: sorted[0],
            weightWithPackaging: product.weight + bestBag.weight,
        };
    }

    if (bestBox) {
        return {
            packaging: bestBox,
            packageDepth: bestBox.length,
            packageWidth: bestBox.width,
            packageHeight: bestBox.height!,
            weightWithPackaging: product.weight + bestBox.weight,
        };
    }

    return null;
}

/**
 * Подбирает упаковку для партии из qty товаров (произвольная укладка).
 * Объём партии / коэф. заполнения (0.65) должен влезть в упаковку.
 * Каждый размер единичного товара должен влезть хотя бы в один размер упаковки.
 */
export function findPackagingForBatch(product: ProductDimensions, qty: number): PackagingResult | null {
    if (qty <= 1) return findPackaging(product);

    const singleVolume = product.depth * product.width * product.height;
    const totalVolume = singleVolume * qty;
    const PACKING_FACTOR = 0.65;
    const requiredVolume = totalVolume / PACKING_FACTOR;

    const sorted = [product.depth, product.width, product.height].sort((a, b) => a - b);

    let best: PackagingOption | null = null;
    let bestVol = Infinity;

    for (const option of PACKAGING_OPTIONS) {
        if (option.type === 'bag') {
            // Пакет для партии: все товары должны лечь плоско стопкой
            // Высота стопки = sorted[0] * qty
            const stackHeight = sorted[0] * qty;
            const bagSorted = [option.width, option.length].sort((a, b) => a - b);
            if (sorted[1] <= bagSorted[0] && sorted[2] <= bagSorted[1]) {
                // Пакет подходит по плоскости, проверяем что стопка не слишком высокая
                // (пакет должен закрыться — стопка ≈ до половины меньшего размера пакета)
                if (stackHeight <= bagSorted[0] / 2) {
                    const vol = bagSorted[0] * bagSorted[1] * stackHeight;
                    if (vol < bestVol) {
                        bestVol = vol;
                        best = option;
                    }
                }
            }
        } else {
            const vol = boxVolume(option);
            if (vol >= requiredVolume && fitsInBox(sorted, option)) {
                if (vol < bestVol) {
                    bestVol = vol;
                    best = option;
                }
            }
        }
    }

    if (!best) return null;

    if (best.type === 'bag') {
        const stackHeight = sorted[0] * qty;
        return {
            packaging: best,
            packageDepth: best.length,
            packageWidth: best.width,
            packageHeight: stackHeight,
            weightWithPackaging: product.weight * qty + best.weight,
        };
    }

    return {
        packaging: best,
        packageDepth: best.length,
        packageWidth: best.width,
        packageHeight: best.height!,
        weightWithPackaging: product.weight * qty + best.weight,
    };
}
