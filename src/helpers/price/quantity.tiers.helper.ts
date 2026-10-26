/**
 * Ступени цены от количества для Sylius (решения владельца 17–18.10.2026).
 *
 * Ступень — цена партии из N штук, посчитанная той же формулой, что и обычная цена (себестоимость × N,
 * упаковка и этикетка один раз), поделённая на N. Средние ступени — середина между обычной и минимальной
 * ценой партии, последняя — минимальная цена партии. Цена за штуку — в копейках.
 */

/** Ступень, как её принимает Sylius: «от quantity штук» по price копеек за штуку. */
export interface QuantityTierDto {
    quantity: number;
    price: number;
}

/** Пороги из Trade (PRICE.QUANMOPT / PRICE.QUANOPT). */
export interface TierThresholdsDto {
    mopt: number;
    opt: number;
}

/** Строка таблицы умолчаний: розничная цена ниже `below` рублей → пороги mopt/opt. `below = null` — последняя строка. */
export interface TierDefaultRow {
    below: number | null;
    mopt: number;
    opt: number;
}

/** Цены партии из calculatePrice: обычная и минимальная, в рублях. */
export interface PartyPriceDto {
    quantity: number;
    price: number;
    min_price: number;
}

/** Умолчания порогов: до 50 ₽ → 10/100, до 200 → 5/20, до 1000 → 3/10, дальше 2/5 (владелец 17.10.2026). */
export const DEFAULT_TIER_THRESHOLDS = '50:10/100,200:5/20,1000:3/10,2/5';

/**
 * Разбор строки умолчаний вида `50:10/100,200:5/20,1000:3/10,2/5` (конфиг SYLIUS_TIER_DEFAULTS).
 * Строка без `граница:` — для всех цен от последней границы и выше. Кривая строка → исключение при старте, не молча.
 */
export function parseTierDefaults(spec: string): TierDefaultRow[] {
    const rows = (spec ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((part): TierDefaultRow => {
            const [boundPart, pairPart] = part.includes(':') ? part.split(':') : [null, part];
            const [mopt, opt] = pairPart.split('/').map((v) => Number(v));
            const below = boundPart === null ? null : Number(boundPart);
            if (!Number.isInteger(mopt) || !Number.isInteger(opt) || !(1 < mopt && mopt < opt)) {
                throw new Error(`Кривые пороги ступеней «${part}»: нужно 1 < мелкий опт < опт`);
            }
            if (below !== null && !(below > 0)) {
                throw new Error(`Кривая граница цены в порогах ступеней «${part}»`);
            }
            return { below, mopt, opt };
        });
    const last = rows[rows.length - 1];
    if (!last || last.below !== null) {
        throw new Error(`Пороги ступеней «${spec}» должны заканчиваться строкой без границы (для всех цен выше)`);
    }
    for (let i = 1; i < rows.length - 1; i++) {
        if (rows[i].below <= rows[i - 1].below) throw new Error(`Границы порогов ступеней «${spec}» не по возрастанию`);
    }
    return rows;
}

/** Пороги по умолчанию от розничной цены в рублях: граница включается в следующий диапазон (ровно 50 ₽ → 5/20). */
export function defaultThresholds(retailRub: number, table: TierDefaultRow[]): TierThresholdsDto {
    const row = table.find((r) => r.below === null || retailRub < r.below) ?? table[table.length - 1];
    return { mopt: row.mopt, opt: row.opt };
}

/**
 * Количества ступеней для товара: пара из Trade, если `1 < мелкий опт < опт`, иначе умолчание от розничной цены.
 * Цены градаций Trade (PRICEMOPT/PRICEOPT) не используются — решение владельца.
 */
export function pickThresholds(
    trade: TierThresholdsDto | undefined,
    retailRub: number,
    table: TierDefaultRow[],
): number[] {
    const valid =
        trade &&
        Number.isInteger(trade.mopt) &&
        Number.isInteger(trade.opt) &&
        1 < trade.mopt &&
        trade.mopt < trade.opt;
    const { mopt, opt } = valid ? trade : defaultThresholds(retailRub, table);
    return [mopt, opt];
}

/**
 * Дешёвая деталь поставщика — закупка за штуку ниже этого, руб. Розница у таких задрана постоянными расходами
 * (резистор 0402 за 0,07 ₽ продаётся по 32–75 ₽), поэтому признак — закупка, а не розница.
 */
export const CHEAP_UNIT_COST_RUB = 1;

/** Ступени дешёвой детали поставщика, шт: третья — от 1000 (владелец 26.10.2026). */
export const CHEAP_THRESHOLDS = [10, 100, 1000];

/**
 * Количества ступеней для товара поставщика, у которого поставщик дал одну цену (своих ступеней нет): дешёвой
 * детали (закупка до CHEAP_UNIT_COST_RUB) — CHEAP_THRESHOLDS, остальным пороги от розничной цены, как у наших товаров.
 */
export function supplierThresholds(retailRub: number, unitCostRub: number, table: TierDefaultRow[]): number[] {
    if (unitCostRub < CHEAP_UNIT_COST_RUB) {
        return [...CHEAP_THRESHOLDS];
    }
    const { mopt, opt } = defaultThresholds(retailRub, table);
    return [mopt, opt];
}

export interface DroppedTierDto {
    quantity: number;
    price: number;
    reason: string;
}

/**
 * Ступени из цен партий. Последняя ступень — min_price партии, остальные — (price + min_price) / 2; за штуку
 * округляется до копейки. Sylius отвергает набор целиком, если ступень дороже обычной цены или дорожает
 * с количеством (равенство допускается), поэтому такие ступени отбрасываются здесь, со сравнением с последней
 * оставленной ступенью. Нечисловая обычная цена — ступеней нет.
 */
export function buildTiers(
    regularKopecks: number,
    parties: PartyPriceDto[],
): { tiers: QuantityTierDto[]; dropped: DroppedTierDto[] } {
    const tiers: QuantityTierDto[] = [];
    const dropped: DroppedTierDto[] = [];
    const sorted = [...parties].sort((a, b) => a.quantity - b.quantity);
    if (!Number.isFinite(regularKopecks) || regularKopecks <= 0) {
        sorted.forEach((p) => dropped.push({ quantity: p.quantity, price: NaN, reason: 'нет обычной цены' }));
        return { tiers, dropped };
    }
    let lastKept = regularKopecks;
    sorted.forEach((party, i) => {
        const isLast = i === sorted.length - 1;
        const partyRub = isLast ? party.min_price : (party.price + party.min_price) / 2;
        const kopecks = Math.round((partyRub / party.quantity) * 100);
        if (!Number.isInteger(party.quantity) || party.quantity <= 1) {
            dropped.push({ quantity: party.quantity, price: kopecks, reason: 'порог не целое > 1' });
        } else if (!Number.isFinite(kopecks) || kopecks <= 0) {
            dropped.push({ quantity: party.quantity, price: kopecks, reason: 'цена партии не число' });
        } else if (kopecks > lastKept) {
            dropped.push({ quantity: party.quantity, price: kopecks, reason: `дороже предыдущей (${lastKept})` });
        } else {
            tiers.push({ quantity: party.quantity, price: kopecks });
            lastKept = kopecks;
        }
    });
    return { tiers, dropped };
}
