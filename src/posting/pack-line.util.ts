import { isSkuMatch } from '../helpers';
import { PostingPackLine } from './interfaces/posting-pack-line';

/**
 * Позиция отправления для кода/строки склада: сперва точная фасовка (goodscode + pieces),
 * иначе — единственная позиция этого goodscode (фасовка кода может не совпасть с артикулом).
 * Несколько мультипаков одного товара и ни одного совпадения по фасовке → null:
 * взять «любой» нельзя — коды уедут в чужой product_id.
 */
export const findPackLine = (lines: PostingPackLine[], goodscode: string, pieces: number): PostingPackLine | null => {
    const exact = lines.find((l) => isSkuMatch(l.offerId, goodscode, pieces));
    if (exact) return exact;
    const sameGood = lines.filter((l) => l.goodscode === goodscode);
    return sameGood.length === 1 ? sameGood[0] : null;
};
