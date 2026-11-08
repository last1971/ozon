import { IPriceable } from '../../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../dto/obtain.coeffs.dto';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { PriceSkip } from '../../price/price-update.report';
import { calculatePrice } from './price.helpers';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { IJobContext } from '../../interfaces/i.job.context';

/** Обрабатывает результаты по строкам; экономическая формула остаётся в calculatePrice. */
export async function calculatePriceBatch(inputs: IPriceable[], coeffs: ObtainCoeffsDto, context?: IJobContext) {
    const prices: UpdatePriceDto[] = [];
    const skipped: PriceSkip[] = [];
    for (const [i, input] of inputs.entries()) {
        if (i % 50 === 0) await jobCheckpoint(context);
        try {
            const target = calculatePrice(input, coeffs);
            if (
                [target.price, target.min_price].some((n) => !Number.isFinite(Number(n)) || Number(n) <= 0) ||
                !Number.isFinite(Number(target.old_price)) ||
                Number(target.old_price) < 0
            )
                throw new Error('Получены некорректные цены');
            prices.push(target);
        } catch (error) {
            skipped.push({
                offer_id: input.offer_id,
                reason: 'pricing-data',
                failureKind: 'data',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return { prices, skipped };
}
