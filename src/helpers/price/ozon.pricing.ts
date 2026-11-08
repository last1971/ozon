import {
    calculateMarketplaceLossCosts,
    calculateTariffReturnDelivery,
    MarketplaceLossCostsInput,
} from './marketplace.loss.costs';
import type { PriceBaseSource } from '../../good/dto/good.price.dto';
import type { PriceBand } from '../../ozon.category/tariff.xlsx';
import { priceInBand } from './ozon.logistics';
import { priceTaxDetails } from './price.tax';

export interface OzonPriceScheme {
    scheme: 'fbs' | 'fbo';
    commissions: (PriceBand & { rate: number })[];
    logistics: (PriceBand & { amount: number; source?: string; warning?: string })[];
    lastMile: number;
    firstMile: number;
    returnFlow?: number | null;
}
/** Ставки — доли, наценки и налоги — проценты. Только данные, без запросов. */
export interface OzonPricingContext {
    warnings?: string[];
    lossStatistics?: Omit<MarketplaceLossCostsInput, 'purchaseCost'>;
    schemes: OzonPriceScheme[];
    acquiringRate: number;
    minProfitRub: number;
    minMarkupPercent: number;
    vatRate: number;
    profitTaxRate: number;
}
export interface OzonPricingInput extends OzonPricingContext {
    base: number;
    lossCosts?: MarketplaceLossCostsInput;
    baseSource?: PriceBaseSource;
    markups: { min: number; normal: number; max: number };
    advertisingPercent: number;
    packing: number;
    label: number;
    handling: number;
    taxPercent: number;
    returnRate: number;
    /** Эффективная скидка: цена продажи = цена до скидок × (1 - discountRate). */
    discountRate?: number;
}
export interface OzonPriceEvaluation {
    price: number;
    salePrice: number;
    profit: number;
    scheme: 'fbs' | 'fbo';
    commissionBand: PriceBand & { rate: number };
    logisticsBand: PriceBand;
    costs: {
        base: number;
        commission: number;
        delivery: number;
        lastMile: number;
        firstMile: number;
        acquiring: number;
        advertising: number;
        packing: number;
        label: number;
        handling: number;
        returns: number;
        cancellations?: number;
        sellerReturns?: number;
        defects?: number;
        defectCompensation?: number;
        tax: number;
        vat: number;
        profitTax: number;
    };
}
const nonnegative = (n: number, label: string) => {
    if (!Number.isFinite(n) || n < 0) throw new Error(`Некорректное значение: ${label}`);
};
function validateBands(rows: PriceBand[], label: string) {
    if (!rows.length) throw new Error(`Нет ${label}`);
    const sorted = [...rows].sort((a, b) => a.min - b.min);
    sorted.forEach((b, i) => {
        nonnegative(b.min, label);
        if (b.max !== null && (!Number.isFinite(b.max) || b.max <= b.min)) throw new Error(`Неверные границы ${label}`);
        const prev = sorted[i - 1];
        if (
            prev &&
            (prev.max === null || prev.max > b.min || (prev.max === b.min && prev.maxIncluded && b.minIncluded))
        )
            throw new Error(`Пересекаются ступени ${label}`);
    });
}
function validate(input: OzonPricingInput) {
    if (!Number.isFinite(input.base) || input.base <= 0 || input.baseSource === 'none')
        throw new Error('Нет базы цены Ozon');
    for (const key of [
        'acquiringRate',
        'minProfitRub',
        'minMarkupPercent',
        'vatRate',
        'profitTaxRate',
        'advertisingPercent',
        'packing',
        'label',
        'handling',
        'taxPercent',
    ] as const)
        nonnegative(input[key], key);
    for (const value of Object.values(input.markups)) nonnegative(value, 'наценка');
    calculateTariffReturnDelivery(input.returnRate, 0, 0);
    if (input.acquiringRate >= 1 || input.taxPercent >= 100 || input.profitTaxRate >= 100)
        throw new Error('Некорректная ставка расходов');
    const discount = input.discountRate ?? 0;
    if (!Number.isFinite(discount) || discount < 0 || discount >= 1) throw new Error('Некорректная скидка');
    if (!input.schemes.length) throw new Error('Нет схемы Ozon с остатком');
    if (new Set(input.schemes.map((s) => s.scheme)).size !== input.schemes.length) throw new Error('Повтор схемы Ozon');
    for (const s of input.schemes) {
        validateBands(s.commissions, 'комиссий');
        validateBands(s.logistics, 'логистики');
        for (const r of s.commissions)
            if (!Number.isFinite(r.rate) || r.rate < 0 || r.rate >= 1) throw new Error('Некорректная комиссия');
        for (const r of s.logistics) nonnegative(r.amount, 'доставка');
        for (const key of ['lastMile', 'firstMile'] as const) nonnegative(s[key], key);
        calculateTariffReturnDelivery(input.returnRate, 0, s.returnFlow);
    }
}
/** Единственное место суммирования расходов и вычисления прибыли Ozon. */
function evaluateScheme(
    input: OzonPricingInput,
    scheme: OzonPriceScheme,
    salePrice: number,
    price: number,
): OzonPriceEvaluation | null {
    const commission = scheme.commissions.find((b) => priceInBand(salePrice, b));
    const delivery = scheme.logistics.find((b) => priceInBand(salePrice, b));
    if (!commission || !delivery) return null;
    const losses = calculateMarketplaceLossCosts(
        input.lossCosts,
        calculateTariffReturnDelivery(input.returnRate, delivery.amount, scheme.returnFlow),
    );
    const costs = {
        ...(input.lossCosts
            ? {
                  cancellations: losses.cancellations,
                  sellerReturns: losses.sellerReturns,
                  defects: losses.defects,
                  defectCompensation: losses.defectCompensation,
              }
            : {}),
        base: input.base,
        commission: salePrice * commission.rate,
        delivery: delivery.amount,
        lastMile: scheme.lastMile,
        firstMile: scheme.firstMile,
        acquiring: salePrice * input.acquiringRate,
        advertising: (salePrice * input.advertisingPercent) / 100,
        packing: input.packing,
        label: input.label,
        handling: input.handling,
        returns: losses.returns,
        tax: (salePrice * input.taxPercent) / 100,
        vat: 0,
        profitTax: 0,
    };
    const fixed =
        costs.delivery + costs.lastMile + costs.firstMile + costs.packing + costs.label + costs.handling + losses.total;
    const dynamic = commission.rate * 100 + input.acquiringRate * 100 + input.advertisingPercent + input.taxPercent;
    let profit = salePrice - input.base - fixed - (salePrice * dynamic) / 100;
    if (input.taxPercent === 0) {
        const details = priceTaxDetails(salePrice, input.base, fixed, dynamic, input.vatRate, input.profitTaxRate);
        costs.vat = details.vatToPay;
        costs.profitTax = details.profitTax;
        profit = details.profitBeforeTax - details.profitTax - details.vatToPay;
    }
    if (!Number.isFinite(profit)) throw new Error('Переполнение расчёта цены Ozon');
    return {
        price,
        salePrice,
        profit,
        scheme: scheme.scheme,
        commissionBand: commission,
        logisticsBand: delivery,
        costs,
    };
}
function evaluate(input: OzonPricingInput, salePrice: number, price: number): OzonPriceEvaluation | null {
    const results = input.schemes.map((s) => evaluateScheme(input, s, salePrice, price));
    if (results.some((r) => !r)) return null;
    return results.reduce((worst, r) => (r.profit < worst.profit ? r : worst));
}
/** Фактическая цена продажи: скидка уже учтена, тариф выбирается по этой цене. */
export function evaluateOzonPrice(input: OzonPricingInput, salePrice: number): OzonPriceEvaluation {
    validate(input);
    nonnegative(salePrice, 'цена продажи');
    const result = evaluate(input, salePrice, salePrice);
    if (!result) throw new Error('Нет тарифа для цены продажи Ozon');
    return result;
}
/** Все пересечения ступеней; в каждом ищем минимальный целый рубль по той же функции прибыли. */
export function calculateOzonPrices(input: OzonPricingInput) {
    validate(input);
    const factor = 1 - (input.discountRate ?? 0);
    const starts = new Set<number>([1]);
    for (const s of input.schemes)
        for (const b of [...s.commissions, ...s.logistics]) {
            for (const boundary of [b.min, b.max])
                if (boundary !== null) {
                    const value = boundary / factor;
                    for (const p of [Math.floor(value), Math.ceil(value), Math.floor(value) + 1])
                        if (Number.isSafeInteger(p) && p >= 1) starts.add(p);
                }
        }
    const limits = [...starts].sort((a, b) => a - b);
    const at = (price: number) => evaluate(input, price * factor, price);
    const solve = (markup: number, floor: number) => {
        const targetProfit = Math.max(
            input.minProfitRub,
            (input.base * Math.max(input.minMarkupPercent, markup)) / 100,
        );
        const candidates: OzonPriceEvaluation[] = [];
        for (let i = 0; i < limits.length; i++) {
            let lo = Math.max(limits[i], floor);
            const end = i + 1 < limits.length ? limits[i + 1] - 1 : Number.MAX_SAFE_INTEGER;
            if (lo > end) continue;
            const initial = at(lo);
            if (!initial) continue;
            if (initial.profit >= targetProfit) {
                candidates.push(initial);
                continue;
            }
            if (lo === end) continue;
            const following = at(lo + 1);
            if (!following || following.profit <= initial.profit) continue;
            let hi = Math.min(end, Math.max(lo + 1, lo * 2));
            while (at(hi)?.profit < targetProfit && hi < end) hi = Math.min(end, hi * 2);
            const upper = at(hi);
            if (!upper || upper.profit < targetProfit) continue;
            while (lo < hi) {
                const mid = lo + Math.floor((hi - lo) / 2);
                if (at(mid).profit >= targetProfit) hi = mid;
                else lo = mid + 1;
            }
            const result = at(lo);
            if (result?.profit >= targetProfit) candidates.push(result);
        }
        if (!candidates.length) throw new Error('Нет допустимой цены Ozon с требуемой прибылью');
        const byTariff = new Map<string, OzonPriceEvaluation>();
        for (const candidate of candidates) {
            const key = JSON.stringify(
                input.schemes.map((s) => [
                    s.scheme,
                    s.commissions.findIndex((b) => priceInBand(candidate.salePrice, b)),
                    s.logistics.findIndex((b) => priceInBand(candidate.salePrice, b)),
                ]),
            );
            if (!byTariff.has(key) || candidate.price < byTariff.get(key).price) byTariff.set(key, candidate);
        }
        const distinct = [...byTariff.values()];
        const chosen = distinct.reduce((a, b) => (a.price <= b.price ? a : b));
        return { ...chosen, targetProfit, candidates: distinct };
    };
    const min = solve(input.markups.min, 1);
    const normal = solve(input.markups.normal, min.price);
    const max = solve(input.markups.max, normal.price);
    return { min, normal, max, baseSource: input.baseSource };
}

/** Граница для существующего планировщика акций с порогом 300 ₽. Без повторного расчёта цены. */
export function ozonDeadZoneFloor(
    input: Pick<OzonPricingInput, 'schemes'>,
    result: ReturnType<typeof calculateOzonPrices>,
): number | undefined {
    const hasLowerBand = input.schemes.some((s) =>
        [...s.commissions, ...s.logistics].some((b) => b.max !== null && b.max <= 300),
    );
    const upper = result.min.candidates.filter(
        (c) => c.salePrice > 300 && (c.commissionBand.min >= 300 || c.logisticsBand.min >= 300),
    );
    return hasLowerBand && upper.length ? Math.min(...upper.map((c) => c.salePrice)) : undefined;
}
