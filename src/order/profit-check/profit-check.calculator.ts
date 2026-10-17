import { toNumber } from 'lodash';
import { calculatePay, calculatePrice } from '../../helpers/price/price.helpers';
import { IPriceable } from '../../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../../helpers/dto/obtain.coeffs.dto';
import { LineVerdict, ProfitLevel, SaleLine } from './profit-check.types';

/**
 * Прибыльность одной строки продажи. Только данные, без базы и сети.
 * Минимальная цена и прибыль — теми же формулами, что считают цены при пересчёте
 * (calculatePrice / calculatePay), поэтому проверка и расчёт цен не разойдутся.
 *
 *  alert — прибыли нет (≤ 0);
 *  warn  — прибыль есть, но цена ниже минимальной больше чем на warnPercent;
 *  ok    — иначе;
 *  skip  — считать не из чего (нет себестоимости или наценок).
 */
export function evaluateLine(
    line: SaleLine,
    priceable: IPriceable | undefined,
    coeffs: ObtainCoeffsDto,
    warnPercent: number,
): LineVerdict {
    const base = {
        ...line,
        minPrice: null,
        profitPerUnit: null,
        profitTotal: null,
        cost: null,
        costSource: null,
    } as LineVerdict;
    if (!priceable) return { ...base, level: 'skip', reason: 'нет себестоимости или наценок' };
    const available = toNumber(priceable.available_price);
    const cost = available > 0 ? available : toNumber(priceable.incoming_price);
    if (!(cost > 0)) return { ...base, level: 'skip', reason: 'нет себестоимости' };
    if (!(line.pricePerUnit > 0)) return { ...base, level: 'skip', reason: 'нет цены продажи' };

    const minPrice = Number(calculatePrice(priceable, coeffs).min_price);
    const pay = calculatePay(priceable, coeffs, line.pricePerUnit);
    const profitPerUnit = pay.netProfit ?? pay.pay - cost;
    const profitTotal = profitPerUnit * line.units;

    let level: ProfitLevel = 'ok';
    if (profitPerUnit <= 0) level = 'alert';
    else if (line.pricePerUnit < minPrice * (1 - warnPercent / 100)) level = 'warn';

    return {
        ...base,
        level,
        minPrice,
        profitPerUnit: round2(profitPerUnit),
        profitTotal: round2(profitTotal),
        cost: round2(cost),
        costSource: available > 0 ? 'доступная цена' : 'приход',
    };
}

const ORDER: ProfitLevel[] = ['skip', 'ok', 'warn', 'alert'];

/** Уровень заказа — худший из строк; строки «не проверено» уровень не поднимают. */
export function worstLevel(levels: ProfitLevel[]): ProfitLevel {
    const real = levels.filter((l) => l !== 'skip');
    if (!real.length) return levels.length ? 'skip' : 'ok';
    return real.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), 'ok');
}

const round2 = (n: number) => Math.round(n * 100) / 100;
