import { formatMoscowShortDateTime } from '../../shared/moscow-time';
import { buyerPrice, ozonActionFloor } from '../../helpers/price/buyer.price.helper';
import { resolveOzonBaseTarget } from '../../helpers/price/ozon-base-target';
import { ozonDisplayPrice } from '../../helpers/price/ozon.display-price';
import type { UpdatePriceDto } from '../../price/dto/update.price.dto';
import {
    OzonActionSlot,
    PriceStep,
    PromoPricePlan,
    PromoPriceState,
    PromoPriceStep,
    PromoTarget,
} from './promo-price.types';

/**
 * Акцию Ozon учитываем за час до старта, раньше — как будто её нет (решение 23.10.2026). Сверка идёт чаще
 * раза в час: за час до начала перестроит цену под неё, и наш процент не сложится с ценой акции ниже минимума.
 */
const ACTION_LEAD_MS = 60 * 60 * 1000;
const counts = (a: OzonActionSlot, now: Date): boolean =>
    !a.startsAt || Date.parse(a.startsAt) - ACTION_LEAD_MS <= now.getTime();
const startText = formatMoscowShortDateTime;

export const inPromoDeadZone = (price: number, floor?: number): boolean =>
    floor !== undefined && price > 300 && price < floor;

// V5 and the participant lists are published separately. Only act on a coherent shared price.
export function hasUnifiedPrice(s: PromoPriceState): boolean {
    const percent = s.seller?.isActive ? s.seller.percent : 0;
    return Number.isSafeInteger(s.price) && s.price > 0 && percent >= 0 && percent < 100 &&
        s.buyerPrice === s.buyerPriceCalc && s.buyerPrice === buyerPrice(s.price, [], percent) &&
        s.ozonActions.every(a => !a.participant || (a.unifiedPrice && !a.isVoucher && a.actionPrice === s.price));
}

export function unifiedBoostPlan(s: PromoPriceState, target: number, requestedPercent?: number): PromoPricePlan | undefined {
    const percent = s.seller?.isActive ? s.seller.percent : 0;
    if (!s.calcMinPrice || target !== s.calcMinPrice || s.buyerPrice >= target ||
        (requestedPercent !== undefined && requestedPercent !== percent) || !hasUnifiedPrice(s)) return;
    const floor = ozonActionFloor(inPromoDeadZone(target, s.deadZoneFloor) ? s.deadZoneFloor : target, percent);
    const buyerAfter = buyerPrice(floor, [], percent);
    const active = s.ozonActions.filter(a => a.participant);
    if (!active.length || !Number.isSafeInteger(floor) || buyerAfter < target ||
        inPromoDeadZone(buyerAfter, s.deadZoneFloor) ||
        s.ozonActions.some(a => a.unifiedPrice && !(a.maxActionPrice > 0))) return;
    const allExit = !s.ozonActions.some(a => a.unifiedPrice && a.maxActionPrice >= floor);
    const first = active.find(a => a.maxActionPrice >= floor) ?? active[0];
    const step: PromoPriceStep = first.maxActionPrice >= floor
        ? { kind: 'ozon-set', actionId: first.actionId, title: first.title, from: first.actionPrice, to: floor }
        : removeStep(first, 'Единая цена выше порога бустинга');
    return {
        offerId: s.offerId, productId: s.productId, state: s, target, percent, floor,
        buyerBefore: s.buyerPrice, buyerAfter, baseAfter: floor, ok: true, closest: false,
        ...(allExit ? { unifiedExit: true } : { unifiedPrice: true }), steps: [step],
        notes: [`Единая предельная цена ${floor} ₽. Проверяем участие в бустингах и цену после скидки.`],
    };
}

/** Изменения акций могут примениться в любом порядке или частично. */
function safeDuringTransition(s: PromoPriceState, plan: PromoPricePlan, now: Date): boolean {
    const newPrices = new Map<number, number>();
    for (const step of plan.steps) {
        if (step.kind === 'ozon-set') newPrices.set(step.actionId, step.to);
        if (step.kind === 'ozon-remove') newPrices.set(step.actionId, Infinity);
    }
    const bases = new Set([s.price]);
    let highestPossibleBase = s.price;
    for (const action of s.ozonActions) {
        if (!counts(action, now)) continue;
        const before = action.participant && action.actionPrice > 0 ? action.actionPrice : Infinity;
        const after = newPrices.get(action.actionId) ?? before;
        bases.add(before);
        bases.add(after);
        // До начала акции её цена ещё не ограничивает остальные.
        if (!action.startsAt || Date.parse(action.startsAt) <= now.getTime())
            highestPossibleBase = Math.min(highestPossibleBase, Math.max(before, after));
    }
    // Любая цена не выше этого предела достижима как минимум: выбираем её у
    // одного слота, а во всех остальных — большее из старой и новой цен.
    const minimum = s.calcMinPrice ?? s.minPrice;
    const percents = new Set([s.seller?.isActive ? s.seller.percent : 0, plan.percent]);
    for (const base of bases) {
        if (base > highestPossibleBase) continue;
        for (const percent of percents) {
            const price = buyerPrice(base, [], percent);
            if (price !== s.buyerPrice && (price < minimum || inPromoDeadZone(price, s.deadZoneFloor))) return false;
        }
    }
    return true;
}

/** Цель в рублях: 'min' → min_price, 'normal' → price, число как есть. Неизвестная строка → ошибка. */
export const targetRubles = (s: PromoPriceState, target: PromoTarget): number => {
    if (target === 'min') return s.minPrice;
    if (target === 'normal') return s.price;
    const t = Number(target);
    if (!(t > 0)) throw new Error(`цель «${target}» — не min, не normal и не цена`);
    return t;
};

/**
 * План для одного товара (решения 19.10.2026). Ничего не вызывает — только считает.
 *
 * 1. Наш процент: участник нашей акции — max(minPercent, заданный); не участник — 0 (сначала пробуем без неё).
 * 2. Пол для Ozon-акций: min_price / (1 − процент).
 * 3. Каждая Ozon-акция: лимит ≥ пола → остаёмся/добавляемся по цене под цель, но в [пол, лимит];
 *    лимит < пола → участник выкидывается, кандидат пропускается. Промокодные: цену не трогаем, только выкидываем.
 * 4. Ozon-акций не осталось → цену держит наша акция: процент под цель от price, не ниже minPercent
 *    и не глубже дна. Кандидат нашей акции в этом случае в неё добавляется.
 */
export const planPromoPrice = (
    s: PromoPriceState,
    target: PromoTarget,
    percentWanted?: number,
    now: Date = new Date(),
    allowUnifiedExit = true,
): PromoPricePlan => {
    const notes: string[] = [];

    /** Эффективный пол: расчётный минимум этапа 6, иначе min_price из API Ozon. */
    const eff = s.calcMinPrice ?? s.minPrice;

    const wanted = targetRubles(s, target);
    const exit = allowUnifiedExit && unifiedBoostPlan(s, wanted, percentWanted);
    if (exit) return exit;
    let t = Math.min(s.price, Math.max(eff, wanted));
    if (t !== wanted) notes.push(`цель ${wanted} вне коридора [${eff}, ${s.price}] — взята ${t}`);

    if (inPromoDeadZone(t, s.deadZoneFloor)) {
        if (s.deadZoneFloor <= s.price) {
            notes.push(`цель ${t} в мёртвой зоне (300, ${s.deadZoneFloor}) — поднята до ${s.deadZoneFloor}`);
            t = s.deadZoneFloor;
        } else {
            notes.push(
                `цель ${t} в мёртвой зоне (300, ${s.deadZoneFloor}), price ${s.price} < ${s.deadZoneFloor} — верхняя ступень недостижима`,
            );
        }
    }

    const initial = planAtFloor(s, t, eff, percentWanted, now, [...notes]);
    if (initial.buyerAfter < eff && s.seller && !s.seller.isActive && percentWanted === undefined) {
        const outside = planAtFloor({ ...s, seller: null }, t, eff, undefined, now, [...notes]);
        if (outside.ok) return {
            ...outside, state: s,
            closest: !outside.steps.length && outside.buyerAfter === s.buyerPrice && outside.buyerAfter !== t,
            notes: [...outside.notes, 'Минимальная скидка продавца опускает цену ниже расчётного минимума; товар остаётся кандидатом'],
        };
    }
    if (!inPromoDeadZone(initial.buyerAfter, s.deadZoneFloor)) return initial;

    // Целая скидка или лимит акции могут оставить итог между тарифными ступенями.
    const upper = s.deadZoneFloor;
    const currentBase = Math.min(
        s.price,
        ...s.ozonActions
            .filter((action) => counts(action, now) && action.participant && action.actionPrice > 0)
            .map((action) => action.actionPrice),
    );
    const currentPercent = s.seller?.isActive ? s.seller.percent : 0;
    const bands: { min: number; max: number }[] = [];
    // При цели на верхней ступени сохраняем отказ после изменения лимитов Ozon:
    // пересчёт такого плана не разрешает самовольно снизить цену до 300.
    if (t <= 300) {
        bands.push({ min: eff, max: 300 });
        if (upper <= s.price) bands.push({ min: Math.max(upper, eff), max: s.price });
    }
    let best: PromoPricePlan | undefined;
    for (const band of bands) {
        const bandTarget = Math.max(band.min, Math.min(t, band.max));
        const consider = (candidate: PromoPricePlan) => {
            if (!candidate.ok || candidate.buyerAfter < band.min || candidate.buyerAfter > band.max) return;
            if (!safeDuringTransition(s, candidate, now)) return;
            const distance = Math.abs(candidate.buyerAfter - t);
            if (
                !best ||
                distance < Math.abs(best.buyerAfter - t) ||
                (distance === Math.abs(best.buyerAfter - t) && candidate.steps.length < best.steps.length)
            )
                best = candidate;
        };
        consider(planAtFloor(s, bandTarget, band.min, percentWanted, now));
        if (!s.seller || percentWanted !== undefined) continue;
        if (!s.seller.isActive) {
            // Кандидат может остаться вне нашей акции.
            consider(planAtFloor({ ...s, seller: null }, bandTarget, band.min, undefined, now));
            continue;
        }
        consider(planAtFloor(s, bandTarget, band.min, currentPercent, now));
        // Проверяем сочетания своей скидки с ценой Ozon, в том числе фиксированным промокодом.
        const firstPercent = s.seller.minPercent;
        const floor = ozonActionFloor(band.min, firstPercent);
        const canCombine = s.ozonActions.some(
            (action) =>
                counts(action, now) &&
                (action.isVoucher ? action.participant && action.actionPrice >= floor : action.maxActionPrice >= floor),
        );
        if (!canCombine) continue;
        const maxPercent = Math.min(99, Math.floor((1 - band.min / s.price) * 100 + 1e-9));
        for (let percent = firstPercent; percent <= maxPercent; percent = Math.floor(percent) + 1)
            consider(planAtFloor(s, bandTarget, band.min, percent, now));
    }
    if (best)
        return {
            ...best,
            state: s,
            target: t,
            closest: !best.steps.length && best.buyerAfter === s.buyerPrice && best.buyerAfter !== t,
            notes: [
                ...notes,
                ...best.notes,
                `Итог ${initial.buyerAfter} в мёртвой зоне (300, ${upper}); ближайшая безопасная цена ${best.buyerAfter}`,
            ],
        };

    return {
        ...initial,
        baseAfter: currentBase,
        buyerAfter: s.buyerPrice,
        percent: currentPercent,
        closest: false,
        ok: false,
        steps: [],
        notes: [
            ...initial.notes,
            `Для цели ${t} нет подходящего плана: итог ${initial.buyerAfter} в мёртвой зоне (300, ${upper})`,
        ],
    };
};

/** Планирует действия при установленной нижней границе выбранной тарифной ступени. */
function planAtFloor(
    s: PromoPriceState,
    t: number,
    minimum: number,
    percentWanted: number | undefined,
    now: Date,
    notes: string[] = [],
): PromoPricePlan {
    const steps: PromoPriceStep[] = [];
    const eff = s.calcMinPrice ?? s.minPrice;
    const seller = s.seller;
    if (!seller && percentWanted)
        notes.push('товара нет среди участников и кандидатов нашей акции — процент не назначить');
    let percent = seller?.isActive ? Math.max(seller.minPercent, percentWanted ?? seller.minPercent) : 0;
    if (seller?.isActive && percentWanted !== undefined && percentWanted < seller.minPercent) {
        notes.push(`процент ${percentWanted} ниже минимума акции ${seller.minPercent} — взят ${seller.minPercent}`);
    }

    const floor = ozonActionFloor(minimum, percent);
    const need = Math.ceil(t / (1 - percent / 100));
    const kept: number[] = [];

    for (const a of s.ozonActions) {
        if (!counts(a, now)) {
            notes.push(`«${a.title}» начнётся ${startText(a.startsAt as string)} — пока не учитываем`);
            continue;
        }
        const fits = a.maxActionPrice > 0 && a.maxActionPrice >= floor;
        if (a.isVoucher) {
            if (a.participant && a.actionPrice > 0 && a.actionPrice < floor) {
                steps.push(removeStep(a, `промокодная, цена ${a.actionPrice} < пол ${floor}`));
            } else if (a.participant) {
                kept.push(a.actionPrice);
            }
            continue;
        }
        if (!fits) {
            if (a.participant) steps.push(removeStep(a, `лимит ${a.maxActionPrice} < пол ${floor}`));
            else notes.push(`«${a.title}»: лимит ${a.maxActionPrice} < пол ${floor} — не добавляем`);
            continue;
        }
        const to = Math.min(a.maxActionPrice, Math.max(floor, need));
        kept.push(to);
        if (to < need) notes.push(`«${a.title}»: лимит ${a.maxActionPrice} не даёт поднять цену до цели`);
        if (!a.participant || a.actionPrice !== to) {
            steps.push({
                kind: 'ozon-set',
                actionId: a.actionId,
                title: a.title,
                from: a.participant ? a.actionPrice : null,
                to,
            });
        }
    }

    if (!kept.length && seller) {
        const pNeed = Math.round((1 - t / s.price) * 100);
        // Заданный процент ограничиваем только исходным минимумом. Если он несовместим
        // с выбранной ступенью, такой вариант проверка итоговой цены отсеет.
        const percentFloor = percentWanted === undefined ? minimum : eff;
        const pMax = Math.floor((1 - percentFloor / s.price) * 100 + 1e-9);
        percent = Math.max(seller.minPercent, percentWanted ?? pNeed);
        if (percent > pMax) {
            if (pMax >= seller.minPercent) {
                notes.push(`процент ${percent} уводит ниже дна — взят ${pMax}`);
                percent = pMax;
            } else {
                notes.push(`даже минимальный процент ${seller.minPercent} уводит ниже дна: price ${s.price} мал`);
                percent = seller.minPercent;
            }
        }
    } else if (!kept.length) {
        notes.push('ни Ozon-акций, ни нашей акции — цена покупателю = price');
    }

    if (seller && (kept.length === 0 || seller.isActive) && (!seller.isActive || seller.percent !== percent)) {
        steps.push({
            kind: 'percent',
            actionId: seller.actionId,
            sku: seller.sku,
            from: seller.isActive ? seller.percent : null,
            to: percent,
        });
    }

    const buyerAfter = buyerPrice(s.price, kept, percent);
    // Следующий шаг рычага без округления: рубль ниже в Ozon-акции или процент больше в нашей.
    const next = kept.length
        ? (Math.min(...kept) - 1) * (1 - percent / 100)
        : seller
          ? s.price * (1 - (percent + 1) / 100)
          : null;
    return {
        offerId: s.offerId,
        productId: s.productId,
        target: t,
        percent,
        floor,
        steps,
        buyerBefore: s.buyerPrice,
        baseAfter: Math.min(s.price, ...kept),
        buyerAfter,
        ok: buyerAfter >= eff && !inPromoDeadZone(buyerAfter, s.deadZoneFloor),
        closest: !steps.length && next !== null && buyerAfter > t && next < t,
        notes,
        state: s,
    };
}

/** Цена покупателю, если Ozon применит только эти шаги из плана. */
export function buyerAfterSteps(s: PromoPriceState, steps: PriceStep[], now: Date = new Date()): number {
    let price = s.price;
    let percent = s.seller?.isActive ? s.seller.percent : 0;
    const prices = new Map<number, number>();
    for (const a of s.ozonActions)
        if (counts(a, now)) prices.set(a.actionId, a.participant && a.actionPrice > 0 ? a.actionPrice : Infinity);
    for (const step of steps) {
        if (step.kind === 'base') price = Number(step.target.price);
        else if (step.kind === 'percent') percent = step.to;
        else if (!prices.has(step.actionId)) continue;
        else if (step.kind === 'ozon-remove') prices.set(step.actionId, Infinity);
        else {
            // Цена бустинга общая: запись в один бустинг меняет её во всех, где товар участвует.
            if (s.ozonActions.find((a) => a.actionId === step.actionId)?.unifiedPrice)
                for (const a of s.ozonActions)
                    if (a.unifiedPrice && Number.isFinite(prices.get(a.actionId))) prices.set(a.actionId, step.to);
            prices.set(step.actionId, step.to);
        }
    }
    return buyerPrice(price, [...prices.values()].filter(Number.isFinite), percent);
}

const MAX_LOWERING_STEPS = 12;

/** Ozon показал цену покупателю, и наша формула её объясняет — только тогда модели можно верить. */
export const formulaMatches = (s: PromoPriceState): boolean => s.buyerPrice > 0 && s.buyerPrice === s.buyerPriceCalc;

/**
 * Что отправить сейчас. Ozon применяет шаги в любом порядке и с задержкой, поэтому за проход
 * идёт одно направление: сначала всё, что поднимает цену покупателю; опускание — только когда
 * поднимать нечего и ни один частичный итог не уходит ниже минимальной. Остальное — следующий проход.
 */
export function stepsToSend(
    s: PromoPriceState,
    steps: PriceStep[],
    minimum: number,
    deadZoneFloor?: number,
    now: Date = new Date(),
): { send: PriceStep[]; deferred: PriceStep[] } {
    const before = buyerAfterSteps(s, [], now);
    const raising: PriceStep[] = [];
    const lowering: PriceStep[] = [];
    for (const step of steps) (buyerAfterSteps(s, [step], now) < before ? lowering : raising).push(step);
    // Формула не объясняет цену Ozon — опускать вслепую нельзя, поднимать можно.
    if (raising.length || !lowering.length || !formulaMatches(s)) return { send: raising, deferred: lowering };
    const safe = (p: number) => p >= minimum && !inPromoDeadZone(p, deadZoneFloor);
    if (lowering.length > MAX_LOWERING_STEPS) return { send: [], deferred: lowering };
    for (let mask = 1; mask < 1 << lowering.length; mask++) {
        const subset = lowering.filter((_, i) => mask & (1 << i));
        if (!safe(buyerAfterSteps(s, subset, now))) return { send: [], deferred: lowering };
    }
    return { send: lowering, deferred: [] };
}

/**
 * Новая базовая цена из пересчёта и план акций под неё (покупатель видит минимальную).
 * Минимум — расчётный из того же пересчёта (min_price), повторно тарифы не считаем.
 */
export function planBaseUpdate(state: PromoPriceState, requested: UpdatePriceDto, now: Date = new Date()) {
    const minimum = Number(requested.min_price);
    const deadZoneFloor = requested.ozonDeadZoneFloor;
    const priced = { ...state, calcMinPrice: minimum, deadZoneFloor };
    const resolved = resolveOzonBaseTarget(requested, priced);
    const target: UpdatePriceDto = {
        ...resolved,
        old_price: String(ozonDisplayPrice(Number(resolved.price), Number(resolved.old_price))),
    };
    const future: PromoPriceState = {
        ...priced,
        price: Number(target.price),
        minPrice: Number(target.min_price),
        oldPrice: Number(target.old_price),
    };
    // Пока товар в акции дешевле базы, Ozon показывает в price цену акции, а саму базу не видно.
    // Такая база цену покупателю не меняет — повторный импорт только сбросил бы цену акции.
    const masked = state.ozonActions.some(
        (a) => counts(a, now) && a.participant && a.actionPrice > 0 && a.actionPrice <= state.price,
    );
    const changesBase =
        (masked ? future.price < state.price : future.price !== state.price) ||
        future.minPrice !== state.minPrice ||
        future.oldPrice !== state.oldPrice;
    // Импорт базы Ozon может сбросить цены акций к новой базе — план считаем от неё.
    const plan = planPromoPrice({ ...future, price: changesBase ? future.price : state.price }, minimum, undefined, now);
    const steps: PriceStep[] = [...(changesBase ? [{ kind: 'base' as const, target }] : []), ...plan.steps];
    return { target, minimum, deadZoneFloor, plan, steps };
}

const removeStep = (a: OzonActionSlot, reason: string): PromoPriceStep => ({
    kind: 'ozon-remove',
    actionId: a.actionId,
    title: a.title,
    from: a.actionPrice,
    reason,
});
