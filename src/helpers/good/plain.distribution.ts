import { GoodDto } from '../../good/dto/good.dto';
import { goodQuantityCoeff } from '../index';

/**
 * Немаркируемый товар: `quantity − reserve` делится между фасовками пропорционально
 * коэффициенту, остаток добивается жадно от большего номинала. Перенесено из
 * GoodsCountProcessor без изменений — поведение обычных товаров не меняется.
 */
export const distributeProportionally = (
    totalQuantity: number,
    skus: { sku: string; coefficient: number }[],
): { [key: string]: number } => {
    const totalCoefficient = skus.reduce((sum, { coefficient }) => sum + coefficient, 0);
    const distribution: { [key: string]: number } = {};
    let allocated = 0;

    // Шаг 1: Пропорциональное распределение
    skus.forEach(({ sku, coefficient }) => {
        const proportion = (totalQuantity * coefficient) / totalCoefficient;
        const scaledUnits = Math.floor(proportion / coefficient);
        distribution[sku] = scaledUnits;
        allocated += scaledUnits * coefficient;
    });

    // Шаг 2: Распределение остатка
    let remaining = totalQuantity - allocated;

    for (const { sku, coefficient } of skus.sort((a, b) => b.coefficient - a.coefficient)) {
        while (remaining >= coefficient) {
            distribution[sku] += 1;
            remaining -= coefficient;
        }
    }

    return distribution;
};

/** Раскладка одного немаркируемого товара по его фасовкам на сервисе. */
export const distributeGoodQuantities = (filteredSkus: string[], good: GoodDto): Map<string, number> => {
    const remainingQuantity = good.quantity - (good.reserve ?? 0);

    return new Map(
        Object.entries(
            distributeProportionally(
                remainingQuantity,
                filteredSkus.map((sku) => ({ sku, coefficient: goodQuantityCoeff({ offer_id: sku }) })),
            ),
        ),
    );
};
