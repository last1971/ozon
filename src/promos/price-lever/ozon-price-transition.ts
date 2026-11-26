import { buyerPrice, ozonActionFloor } from '../../helpers/price/buyer.price.helper';
import { observedOzonBase, resolveOzonBaseTarget } from '../../helpers/price/ozon-base-target';
import { ozonDisplayPrice } from '../../helpers/price/ozon.display-price';
import type { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { hasUnifiedPrice, inPromoDeadZone, planPromoPrice, unifiedBoostPlan } from './promo-price.planner';
import type { OzonActionSlot, PromoPricePlan, PromoPriceState, PromoPriceStep } from './promo-price.types';

type BaseChange = { kind: 'base'; target: UpdatePriceDto };
type Change = PromoPriceStep | BaseChange;
type Range = { min: number; max?: number };

export interface OzonTransitionStep {
    change: Change;
    offerId: string;
    productId: number;
    floor: number;
    buyerPrices: number[];
    /** v5 sometimes shows an action price that conceals the seller's underlying list price. */
    buyerRanges?: Range[];
    /** New min/old fields also witness this import when an action hides the new list price. */
    confirmMaskedBase?: boolean;
}

export interface OzonPriceTransition {
    ok: boolean;
    buyerAfter?: number;
    inconsistentSnapshot?: boolean;
    steps: OzonTransitionStep[];
    reason?: string;
}

type Slot = { action: OzonActionSlot; prices: number[] };
type Model = {
    minPrice: number;
    oldPrice: number;
    low: number;
    high: number;
    percent: number;
    sellerActive: boolean;
    slots: Slot[];
};
type Safety = { minimum: number; upper: number };

const failed = (reason: string): OzonPriceTransition => ({ ok: false, steps: [], reason });
const starts = (slot: OzonActionSlot) => (slot.startsAt ? Date.parse(slot.startsAt) : -Infinity);
const net = (base: number, percent: number) => buyerPrice(base, [], percent);
const unique = (xs: number[]) => [...new Set(xs)];
const active = (s: PromoPriceState, time: number) => s.ozonActions.filter((a) => a.participant && starts(a) <= time);

/**
 * Calculate every reachable minimum of independent slots, without enumerating 2^n reset combinations.
 * A particular slot can determine the minimum iff every other slot can be at least that expensive.
 */
function amounts(m: Model, time: number): Range[] {
    const slots = m.slots.filter((s) => starts(s.action) <= time);
    const ceiling = Math.min(m.high, ...slots.map((s) => Math.max(...s.prices)));
    const possible = unique(slots.flatMap((s) => s.prices).filter((p) => Number.isFinite(p) && p <= ceiling));
    const ranges = possible.map((p) => ({ min: net(p, m.percent), max: net(p, m.percent) }));
    if (m.low <= ceiling)
        ranges.push({
            min: net(m.low, m.percent),
            max: Number.isFinite(ceiling) ? net(ceiling, m.percent) : undefined,
        });
    return ranges;
}

function contains(r: Range, price: number) {
    return price >= r.min && price <= (r.max ?? Infinity);
}

function safe(r: Range, economics: Safety) {
    return (
        r.min >= economics.minimum && (economics.upper <= 301 || (r.max ?? Infinity) <= 300 || r.min >= economics.upper)
    );
}

function describeChange(change: Change): string {
    switch (change.kind) {
        case 'base':
            return `Установка базовой цены ${change.target.price} ₽`;
        case 'percent':
            return `Установка скидки продавца ${change.to}%`;
        case 'ozon-set':
            return `Установка цены ${change.to} ₽ в акции «${change.title}»`;
        case 'ozon-remove':
            return `Исключение из акции «${change.title}»`;
    }
}

function unsafeAmount(range: Range, economics: Safety): string {
    if (range.min < economics.minimum)
        return `возможна цена покупателю ${range.min} ₽ при минимуме ${economics.minimum} ₽`;
    const price = Math.max(301, range.min);
    return `возможна цена покупателю ${price} ₽ между тарифными границами 300 и ${economics.upper} ₽`;
}

export { observedOzonBase } from '../../helpers/price/ozon-base-target';

function initialModel(s: PromoPriceState, time: number, confirmedBase?: number): Model {
    const masked = observedOzonBase(s, new Date(time)) === undefined;
    const trustedBase = masked && Number.isFinite(confirmedBase) && confirmedBase >= s.price ? confirmedBase : s.price;
    return {
        minPrice: s.minPrice,
        oldPrice: s.oldPrice,
        low: trustedBase,
        high: masked && trustedBase !== confirmedBase ? Infinity : trustedBase,
        percent: s.seller?.isActive ? s.seller.percent : 0,
        sellerActive: Boolean(s.seller?.isActive),
        slots: s.ozonActions.map((action) => ({
            action,
            prices: [action.participant ? action.actionPrice : Infinity],
        })),
    };
}

function applyChange(m: Model, change: Change): Model {
    if (change.kind === 'percent') return { ...m, percent: change.to, sellerActive: true };
    if (change.kind === 'base') {
        const base = Number(change.target.price);
        const minPrice = Number(change.target.min_price);
        return {
            ...m,
            minPrice,
            oldPrice: Number(change.target.old_price),
            low: base,
            high: base,
            slots: m.slots.map((s) => ({
                ...s,
                prices: s.prices.includes(Infinity)
                    ? s.prices
                    : unique([
                          ...s.prices,
                          base,
                          ...(minPrice > m.minPrice && s.prices.some((p) => p < minPrice) ? [minPrice] : []),
                      ]),
            })),
        };
    }
    return {
        ...m,
        slots: m.slots.map((s) =>
            s.action.actionId === change.actionId
                ? { ...s, prices: [change.kind === 'ozon-remove' ? Infinity : change.to] }
                : s,
        ),
    };
}

function slotSatisfied(m: Model, change: PromoPriceStep) {
    if (change.kind === 'percent') return m.sellerActive && m.percent === change.to;
    const slot = m.slots.find((s) => s.action.actionId === change.actionId);
    const price = change.kind === 'ozon-remove' ? Infinity : change.to;
    return !slot ? change.kind === 'ozon-remove' : slot.prices.every((p) => p === price);
}

/** Integer percent to send is always derived from the seller's current observed action. */
function sellerChange(s: PromoPriceState, m: Model, to: number): PromoPriceStep {
    return {
        kind: 'percent',
        actionId: s.seller.actionId,
        sku: s.seller.sku,
        from: m.sellerActive ? m.percent : null,
        to,
    };
}

/** Can the V5 price equal the requested base, or is it hidden by a cheaper active Ozon price? */
function masks(s: PromoPriceState, base: number, now: number) {
    return s.price < base && active(s, now).some((a) => a.actionPrice === s.price);
}

export function transitionStepConfirmed(s: PromoPriceState, step: OzonTransitionStep, now = new Date()): boolean {
    if (
        !s ||
        s.offerId !== step.offerId ||
        s.productId !== step.productId ||
        !(s.buyerPrice > 0) ||
        s.buyerPrice !== s.buyerPriceCalc ||
        !(step.buyerPrices.includes(s.buyerPrice) || step.buyerRanges?.some((r) => contains(r, s.buyerPrice)))
    )
        return false;
    return changeObserved(s, step, now);
}

// A confirmed campaign mutation and an unexpected buyer price can coexist:
// another campaign can have changed while the marketplace published its reply.
// Close only that mutation; a new read and plan are required before another write.
export function campaignChangedAtDifferentPrice(s: PromoPriceState, step: OzonTransitionStep, now = new Date()) {
    const change = step.change;
    if (change.kind === 'base' || s.offerId !== step.offerId || s.productId !== step.productId ||
        !(s.buyerPrice > 0) || s.buyerPrice !== s.buyerPriceCalc ||
        (change.kind !== 'ozon-remove' && change.from === change.to)) return false;
    const base = observedOzonBase(s, now) ?? s.confirmedBase;
    const frame = initialModel(s, +now, base);
    return amounts(frame, +now).some(range => contains(range, s.buyerPrice)) && changeObserved(s, step, now);
}

function changeObserved(s: PromoPriceState, step: OzonTransitionStep, now: Date) {
    const change = step.change;
    if (change.kind === 'base') {
        const target = change.target;
        return (
            s.minPrice === Number(target.min_price) &&
            s.oldPrice === Number(target.old_price) &&
            (s.price === Number(target.price) ||
                (step.confirmMaskedBase === true && masks(s, Number(target.price), +now)))
        );
    }
    if (change.kind === 'percent')
        return (
            s.seller?.isActive === true &&
            s.seller.sku === change.sku &&
            s.seller.actionId === change.actionId &&
            s.seller.percent === change.to
        );
    const slot = s.ozonActions.find((a) => a.actionId === change.actionId);
    return change.kind === 'ozon-remove'
        ? !slot?.participant
        : slot?.participant === true && slot.actionPrice === change.to;
}

/**
 * Find a safe ordering before sending its first step. After each readback callers replan.
 * A base import may reset any subset of participant prices to the new base. An existing
 * discount below the tariff floor may be held by several tied actions; lifting them can
 * preserve the original price until the last tie is removed.
 */
export function planOzonPriceTransition(
    state: PromoPriceState,
    goal: UpdatePriceDto | PromoPricePlan,
    now = new Date(),
    confirmedBase?: number,
): OzonPriceTransition {
    const baseTarget = 'offer_id' in goal ? resolveOzonBaseTarget(goal, state) : undefined;
    confirmedBase = observedOzonBase(state, now) ?? confirmedBase ?? state.confirmedBase;
    const minimum = Math.max(state.calcMinPrice ?? state.minPrice, baseTarget ? Number(baseTarget.min_price) : 0);
    const upper = Math.max(state.deadZoneFloor ?? 0, baseTarget?.ozonDeadZoneFloor ?? 0);
    if (
        (state.seller?.isActive && !(state.seller.percent >= 0 && state.seller.percent < 100)) ||
        !(minimum > 0) ||
        !Number.isFinite(minimum) ||
        !Number.isFinite(upper) ||
        !(state.price > 0) ||
        !(state.buyerPrice > 0) ||
        state.buyerPrice !== state.buyerPriceCalc ||
        state.ozonActions.some(
            (a) => (a.participant && !(a.actionPrice > 0)) || (a.startsAt && !Number.isFinite(starts(a))),
        )
    )
        return failed('Цена покупателя или исходные условия акций Ozon не подтверждены');
    if (!('offer_id' in goal) && (goal.unifiedExit || goal.unifiedPrice)) {
        if (state.productId !== goal.productId || state.offerId !== goal.offerId || !hasUnifiedPrice(state) ||
            (state.seller?.isActive ? state.seller.percent : 0) !== goal.percent ||
            state.seller?.actionId !== goal.state.seller?.actionId || state.seller?.sku !== goal.state.seller?.sku)
            return { ...failed('Ждём согласованных цен и участия в бустингах Ozon'), inconsistentSnapshot: true };
        const intended = goal.steps[0];
        const slot = intended && intended.kind !== 'percent' && state.ozonActions.find(a => a.actionId === intended.actionId);
        const membershipMatches = goal.unifiedExit ? !state.ozonActions.some(a => a.participant) :
            intended?.kind === 'ozon-set' ? slot?.participant && slot.actionPrice === intended.to :
            intended?.kind === 'ozon-remove' && !slot?.participant;
        if (state.price === goal.floor && state.buyerPrice === goal.buyerAfter && state.buyerPrice >= minimum &&
            !inPromoDeadZone(state.buyerPrice, upper) && membershipMatches)
            return { ok: true, steps: [], buyerAfter: state.buyerPrice };
        if (state.price === goal.floor && state.buyerPrice === goal.buyerAfter && !membershipMatches)
            return { ...failed('Ждём выхода товара из всех бустингов Ozon'), inconsistentSnapshot: true };
        const fresh = unifiedBoostPlan(state, goal.target, goal.percent);
        if (!fresh || fresh.floor !== goal.floor || fresh.buyerAfter !== goal.buyerAfter)
            return failed('Условия бустинга изменились. Требуется новый план');
        return { ok: true, buyerAfter: fresh.buyerAfter, steps: [{
            offerId: state.offerId, productId: state.productId, change: fresh.steps[0], floor: fresh.floor,
            buyerPrices: [fresh.buyerAfter],
        }] };
    }
    const currentTime = +now;
    const frame = initialModel(state, currentTime, confirmedBase);
    if (!amounts(frame, currentTime).some((r) => contains(r, state.buyerPrice)))
        return { ...failed('Цена покупателя расходится с действующими акциями Ozon'), inconsistentSnapshot: true };
    const normal = baseTarget ? Number(baseTarget.price) : state.price;
    const old = baseTarget ? Number(baseTarget.old_price) : state.oldPrice;
    if (
        baseTarget &&
        (baseTarget.offer_id !== state.offerId ||
            !Number.isFinite(normal) ||
            normal < minimum ||
            !(Number(baseTarget.min_price) > 0) ||
            !Number.isFinite(old) ||
            old < 0)
    )
        return failed('Новая базовая цена несовместима с расчётным минимумом или данными товара');
    const metadataMatches = baseTarget && state.minPrice === Number(baseTarget.min_price) && state.oldPrice === old;
    const alreadyAtBase =
        metadataMatches &&
        ((frame.low === normal && frame.high === normal) ||
            (confirmedBase === normal && masks(state, normal, currentTime)));
    const needsBase = Boolean(baseTarget && !alreadyAtBase);
    const projectedBuyer = buyerPrice(
        normal,
        active(state, currentTime).map((a) => a.actionPrice),
        frame.percent,
    );
    const plan = baseTarget
        ? planPromoPrice(
              {
                  ...state,
                  price: normal,
                  minPrice: Number(baseTarget.min_price),
                  buyerPrice: projectedBuyer,
                  buyerPriceCalc: projectedBuyer,
                  calcMinPrice: minimum,
                  deadZoneFloor: upper,
              },
              minimum,
              undefined,
              now,
              false,
          )
        : (goal as PromoPricePlan);
    if (plan.offerId !== state.offerId || plan.productId !== state.productId)
        return failed('План составлен для другого товара Ozon');
    const finalPrice = { min: plan.buyerAfter, max: plan.buyerAfter };
    if (!safe(finalPrice, { minimum, upper }))
        return failed(`Конечная цена не подходит — ${unsafeAmount(finalPrice, { minimum, upper })}`);
    if (!plan.ok) return failed(plan.notes.at(-1) ?? `Не удалось подтвердить конечную цену при минимуме ${minimum} ₽`);
    if (
        !baseTarget &&
        (plan.state.seller?.actionId !== state.seller?.actionId || plan.state.seller?.sku !== state.seller?.sku)
    )
        return failed('У товара изменилась акция продавца. Требуется новый план');
    // Persisted manual plans keep their absolute goals, but limits and identities come from the fresh snapshot.
    for (const change of plan.steps) {
        if (change.kind === 'percent') {
            const seller = state.seller;
            if (
                !seller ||
                seller.actionId !== change.actionId ||
                seller.sku !== change.sku ||
                !Number.isInteger(change.to) ||
                change.to < seller.minPercent ||
                change.to >= 100
            )
                return failed('Условия акции продавца изменились. Требуется новый план');
        } else if (change.kind === 'ozon-set') {
            const slot = state.ozonActions.find((a) => a.actionId === change.actionId);
            if (
                !slot ||
                slot.isVoucher ||
                !Number.isFinite(change.to) ||
                !(change.to > 0) ||
                ((!slot.participant || slot.actionPrice !== change.to) && !(slot.maxActionPrice >= change.to))
            )
                return failed('Изменился лимит или доступность акции Ozon. Требуется новый план');
        }
    }
    const horizon = currentTime + 3_600_000;
    // A delayed acknowledgement may outlive the planner's one-hour preparation window.
    // Also check later starts of every already enrolled action before changing its discount.
    const timings = unique([
        currentTime,
        ...state.ozonActions
            .filter((a) => a.participant || starts(a) <= horizon)
            .map(starts)
            .filter((t) => t > currentTime),
    ]).sort((a, b) => a - b);
    const targetTime = Math.max(...timings.filter((t) => t <= horizon));
    const changes = [...plan.steps];
    // Pins that need no writes today can be reset by the import. Include their restoration
    // only on the affected branch, after the observed import results are known.
    if (needsBase) {
        for (const slot of state.ozonActions) {
            if (
                !slot.participant ||
                slot.isVoucher ||
                starts(slot) > targetTime ||
                slot.actionPrice === normal ||
                changes.some((c) => c.kind !== 'percent' && c.actionId === slot.actionId)
            )
                continue;
            changes.push({
                kind: 'ozon-set',
                actionId: slot.actionId,
                title: slot.title,
                from: slot.actionPrice,
                to: slot.actionPrice,
            });
        }
    }
    const finalPercent = plan.percent;
    const hasSellerTarget = Boolean(
        state.seller && (state.seller.isActive || changes.some((c) => c.kind === 'percent')),
    );
    if (hasSellerTarget && !changes.some((c) => c.kind === 'percent'))
        changes.push(sellerChange(state, frame, finalPercent));
    // Search is synchronous and runs for the whole catalog; unusual numbers of concurrent
    // actions must not exhaust the event loop. An unproved route never reaches the sender.
    const maxStates = 4096;
    const checked = new Set<string>();
    const bounds = { minimum, upper };
    let firstUnsafe: string | undefined;
    let missingProof: string | undefined;

    let allowProtectedImport = false;
    function search(m: Model, baseDue: boolean, bridgeAvailable: boolean): OzonTransitionStep[] | undefined {
        const key = JSON.stringify([
            baseDue,
            m.minPrice,
            m.oldPrice,
            m.low,
            Number.isFinite(m.high) ? m.high : null,
            m.sellerActive,
            m.percent,
            m.slots.map((s) => s.prices),
            bridgeAvailable,
        ]);
        if (checked.size >= maxStates || checked.has(key)) return;
        checked.add(key);
        // The seller discount can change between steps. Price an alternative outcome
        // (Ozon retaining a participant) at the discount in force at this step.
        const actionFloor = Math.max(plan.floor, ozonActionFloor(minimum, m.percent));
        const remaining = changes.filter((c) => !slotSatisfied(m, c));
        if (!baseDue && !remaining.length) {
            const terminal = amounts(m, targetTime);
            if (
                terminal.length &&
                terminal.every((r) => r.min === plan.buyerAfter && r.max === plan.buyerAfter) &&
                timings.every((t) => amounts(m, t).every((r) => safe(r, bounds)))
            )
                return [];
            const mismatch = terminal.find((r) => r.min !== plan.buyerAfter || r.max !== plan.buyerAfter);
            if (mismatch) {
                const possible =
                    mismatch.min !== plan.buyerAfter
                        ? mismatch.min
                        : Math.min(mismatch.min + 1, mismatch.max ?? Infinity);
                missingProof ??= `Итог ${plan.buyerAfter} ₽ нельзя подтвердить. При наблюдаемых ценах акций покупатель может заплатить ${possible} ₽`;
            }
            return;
        }

        const attempt = (change: Change, bridging = false, stagingImport = false): OzonTransitionStep[] | undefined => {
            if (checked.size >= maxStates) return;
            // Do not release the temporary floor under a promotion we still have to exit.
            // Each confirmed step starts a fresh search, including after a restart.
            if (change.kind === 'base' && Number(change.target.min_price) < m.minPrice) {
                const discountedFloor = net(Number(change.target.min_price), m.percent);
                if (!safe({ min: discountedFloor, max: discountedFloor }, bounds) &&
                    remaining.some(step => step.kind === 'ozon-remove')) return;
            }
            const next = applyChange(m, change);
            const prices = timings.flatMap((t) => amounts(next, t));
            // When several tied actions hold an already insufficient price, lifting the first
            // one cannot improve the observed price yet. It may only preserve that exact price.
            const admissible = (result: Model, candidate: Change, alternate?: string) =>
                timings.every((t) => {
                    const before = amounts(m, t);
                    const unchanged = (r: Range) => r.min === state.buyerPrice && r.max === state.buyerPrice;
                    const noNewLoss =
                        before.every(unchanged) ||
                        (state.buyerPrice < minimum &&
                            before.some(unchanged) &&
                            (candidate.kind === 'ozon-remove' ||
                                (candidate.kind === 'ozon-set' && net(candidate.to, m.percent) >= minimum)));
                    const invalid = amounts(result, t).find((r) => !safe(r, bounds) && !(noNewLoss && unchanged(r)));
                    if (!invalid) return true;
                    firstUnsafe ??= `${describeChange(change)} — ${alternate ?? ''}${unsafeAmount(invalid, bounds)}`;
                    return false;
                });
            if (!prices.length || !admissible(next, change)) return;
            // Ozon can exclude a product on update, or keep a non-voucher participant at the
            // supplied floor on a removal request. Subsequent steps require the intended result.
            if (change.kind === 'ozon-set' || change.kind === 'ozon-remove') {
                const slot = m.slots.find((s) => s.action.actionId === change.actionId)?.action;
                if (!slot || (change.kind === 'ozon-set' && (slot.isVoucher || !(slot.maxActionPrice >= change.to))))
                    return;
                const alternative: PromoPriceStep =
                    change.kind === 'ozon-set'
                        ? {
                              kind: 'ozon-remove',
                              actionId: slot.actionId,
                              title: slot.title,
                              from: change.from,
                              reason: 'Исключение при обновлении',
                          }
                        : {
                              kind: 'ozon-set',
                              actionId: slot.actionId,
                              title: slot.title,
                              from: change.from,
                              to: actionFloor,
                          };
                if (
                    (change.kind === 'ozon-set' || !slot.isVoucher) &&
                    !admissible(
                        applyChange(m, alternative),
                        alternative,
                        change.kind === 'ozon-set'
                            ? 'если Ozon исключит товар, '
                            : 'если Ozon оставит товар в акции по отправленной цене, ',
                    )
                )
                    return;
            }
            // Without a change in the observed price-list fields, an active cheaper slot can mask
            // both the old and new base. An acknowledgement alone cannot distinguish the two snapshots.
            const changesMetadata =
                change.kind === 'base' &&
                (Number(change.target.min_price) !== m.minPrice || Number(change.target.old_price) !== m.oldPrice);
            if (
                change.kind === 'base' &&
                !changesMetadata &&
                !(m.low === normal && m.high === normal) &&
                m.slots.some(
                    (s) => starts(s.action) <= currentTime && s.prices.some((p) => p <= normal && p < Infinity),
                )
            ) {
                missingProof ??= `Ozon может скрыть базовую цену ${normal} ₽ за ценой акции. Минимальная и зачёркнутая цены уже совпадают, подтвердить импорт по ответу Ozon не удастся`;
                return;
            }
            const rest = search(
                next,
                baseDue && (change.kind !== 'base' || stagingImport),
                bridgeAvailable && !bridging,
            );
            if (!rest) return;
            const buyerRanges = prices.filter((r) => r.min !== r.max);
            return [
                {
                    change,
                    floor: actionFloor,
                    offerId: state.offerId,
                    productId: state.productId,
                    buyerPrices: unique(prices.filter((r) => r.min === r.max).map((r) => r.min)),
                    ...(buyerRanges.length ? { buyerRanges } : {}),
                    ...(changesMetadata ? { confirmMaskedBase: true } : {}),
                },
                ...rest,
            ];
        };
        if (baseDue) {
            const path = attempt({ kind: 'base', target: baseTarget });
            if (path) return path;
        }
        for (const change of remaining) {
            const path = attempt(change.kind === 'percent' ? sellerChange(state, m, change.to) : change);
            if (path) return path;
        }
        if (baseDue && metadataMatches && m.minPrice === Number(baseTarget.min_price)) {
            // First lift a masking slot just above the requested list price when its current
            // limit allows it. This exposes the real base without leaving the campaign.
            for (const slot of m.slots) {
                if (
                    m.slots.filter((s) => starts(s.action) <= currentTime && s.prices.some(Number.isFinite)).length !==
                        1 ||
                    !slot.action.participant ||
                    slot.action.isVoucher ||
                    starts(slot.action) > currentTime ||
                    !slot.prices.some((p) => p <= normal) ||
                    slot.action.maxActionPrice < normal + 1
                )
                    continue;
                const path = attempt({
                    kind: 'ozon-set',
                    actionId: slot.action.actionId,
                    title: slot.action.title,
                    from: slot.action.actionPrice,
                    to: normal + 1,
                });
                if (path) return path;
            }
        }
        if (baseDue && allowProtectedImport) {
            // While the normal price is hidden, tighten the actual marketplace floor during the
            // import. The second import restores the requested floor; neither old_price nor the
            // advertised regular price is used as a synthetic marker. Both writes need readback.
            // Keep the temporary floor below the regular price so that an import does
            // not rely on Ozon accepting equal regular and minimum prices.
            const protectedMin = Math.min(normal - 1, actionFloor > minimum ? actionFloor : normal - 1);
            if (protectedMin > Math.max(minimum, m.minPrice)) {
                const path = attempt(
                    { kind: 'base', target: { ...baseTarget, min_price: String(protectedMin) } },
                    false,
                    true,
                );
                if (path) return path;
            }
            // The active seller discount can make even the requested regular price
            // insufficient. Cover that discount until its change is actually observed.
            // Keep the calculated crossed-out price and restore the requested base.
            if (baseTarget.ozonCalculated && m.sellerActive && net(normal, m.percent) < minimum) {
                const floor = ozonActionFloor(minimum, m.percent);
                const temporaryBase = floor + 1;
                if (floor > m.minPrice && temporaryBase < old && ozonDisplayPrice(temporaryBase, old) === old) {
                    const path = attempt({ kind: 'base', target: {
                        ...baseTarget, price: String(temporaryBase), min_price: String(floor),
                    } }, false, true);
                    if (path) return path;
                }
            }
        }
        if (!bridgeAvailable || !hasSellerTarget) return;
        // Prefer the closest legal temporary percent to the desired final discount.
        const first = Math.ceil(state.seller.minPercent);
        const candidates = Array.from({ length: Math.max(0, 100 - first) }, (_, i) => i + first)
            .filter((p) => p !== m.percent && p !== finalPercent)
            .sort((a, b) => Math.abs(a - finalPercent) - Math.abs(b - finalPercent) || a - b);
        for (const pct of candidates) {
            const path = attempt(sellerChange(state, m, pct), true);
            if (path) return path;
        }
    }

    let steps = search(frame, needsBase, false) ?? search(frame, needsBase, true);
    if (!steps && needsBase) {
        checked.clear();
        allowProtectedImport = true;
        steps = search(frame, needsBase, false) ?? search(frame, needsBase, true);
    }
    if (steps) {
        // A base import may start with a boost exit. Ozon can publish the new shared
        // price for all participating actions after this single write. Replan on readback.
        const first = steps[0];
        if (baseTarget && (first?.change.kind === 'ozon-remove' || first?.change.kind === 'ozon-set')) {
            const shared = unifiedBoostPlan(state, minimum);
            if (shared && shared.floor === first.floor && shared.steps[0].kind === first.change.kind &&
                (first.change.kind !== 'ozon-set' || first.change.to === shared.floor) &&
                shared.steps[0].actionId === first.change.actionId)
                first.buyerPrices = unique([...first.buyerPrices, shared.buyerAfter]);
        }
        return { ok: true, steps, buyerAfter: plan.buyerAfter };
    }
    const summary =
        checked.size >= maxStates
            ? 'Достигнут предел перебора вариантов акций, безопасный переход не подтверждён'
            : 'Безопасная последовательность не найдена';
    return failed([summary, firstUnsafe, missingProof].filter(Boolean).join('. '));
}
