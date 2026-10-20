/**
 * Списки витрин сайта (Sylius) по данным Trade, решения владельца 20.10.2026.
 * Чистые функции: на входе строки из базы и множество кодов с остатком в магазине, на выходе — коды
 * GOODSCODE строкой в порядке показа, без повторов, не больше лимита. Сайт сам отбросит товары без фото.
 */

export type ShowcaseList = 'new' | 'hits' | 'arrivals' | 'deals';

/** Окно для хитов. */
export const SHOWCASE_WINDOW_DAYS = 90;
/** Окно для новинок: 90 дней давали ~46 товаров, владелец расширил до 180 (20.10.2026). */
export const NEW_WINDOW_DAYS = 180;
/** Окно для «Свежих поступлений» (приходы от поставщика). */
export const ARRIVALS_WINDOW_DAYS = 30;
/**
 * Поставщики, чьи «приходы» — не поставка: возвраты и пересортица (решение владельца 20.10.2026):
 * 1079 NONAME, 1246 ПП, 2713 Интернет решения. Переопределяется env SHOWCASE_NOT_ARRIVAL_SUPPLIERS.
 */
export const DEFAULT_NOT_ARRIVAL_SUPPLIERS = '1079,1246,2713';
/** Больше сайт не принимает. */
export const SHOWCASE_LIMIT = 200;
/** Хит — хотя бы столько продаж (документов) за окно. */
export const HITS_MIN_SALES = 2;

/** Первый приход товара в магазин. */
export interface ShowcaseArrival {
    code: string;
    firstIn: Date;
}

/** Последний приход товара в магазин от поставщика. */
export interface ShowcaseSupplierArrival {
    code: string;
    lastIn: Date;
}

/** Продажи товара из одного источника: документы и штуки. Источники складываются. */
export interface ShowcaseSales {
    code: string;
    /** Число документов: строка кассы или счёт-фактура. */
    sales: number;
    pieces: number;
}

/** Цена, ушедшая на сайт, в копейках: price — со скидкой, originalPrice — зачёркнутая. */
export interface ShowcaseDealPrice {
    code: string;
    price: number;
    originalPrice: number;
}

/** Начало окна: полночь по местному времени, days дней назад (как CAST('NOW' AS DATE) - 90 в Trade). */
export const showcaseSince = (now: Date, days = SHOWCASE_WINDOW_DAYS): Date => {
    const since = new Date(now);
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);
    return since;
};

/** Коды — числа строкой: сравниваем как числа, нечисловые — как строки после них. */
const byCode = (a: string, b: string): number => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
};

const firstUnique = (codes: string[], limit: number): string[] => [...new Set(codes)].slice(0, limit);

/** Свежие первыми по дате, при равенстве — больший код; только в наличии и не раньше since. */
const freshFirst = (rows: { code: string; at: Date }[], inStock: Set<string>, since: Date, limit: number): string[] =>
    firstUnique(
        rows
            .filter((r) => inStock.has(r.code) && r.at.getTime() >= since.getTime())
            .sort((a, b) => b.at.getTime() - a.at.getTime() || byCode(b.code, a.code))
            .map((r) => r.code),
        limit,
    );

/** Новинки: первый приход не раньше since, есть в магазине. Свежие первыми, при равенстве — больший код. */
export const buildNewList = (
    arrivals: ShowcaseArrival[],
    inStock: Set<string>,
    since: Date,
    limit = SHOWCASE_LIMIT,
): string[] =>
    freshFirst(
        arrivals.map((a) => ({ code: a.code, at: a.firstIn })),
        inStock,
        since,
        limit,
    );

/** Свежие поступления: последний приход от поставщика не раньше since, есть в магазине. Свежие первыми. */
export const buildArrivalsList = (
    arrivals: ShowcaseSupplierArrival[],
    inStock: Set<string>,
    since: Date,
    limit = SHOWCASE_LIMIT,
): string[] =>
    freshFirst(
        arrivals.map((a) => ({ code: a.code, at: a.lastIn })),
        inStock,
        since,
        limit,
    );

/** Разбор списка кодов поставщиков из env: «1079, 1246,2713» → [1079, 1246, 2713]; мусор — исключение при запуске. */
export const parseSupplierCodes = (raw: string): number[] => {
    const codes = String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const bad = codes.filter((c) => !/^\d+$/.test(c));
    if (bad.length) throw new Error(`SHOWCASE_NOT_ARRIVAL_SUPPLIERS: не коды поставщиков — ${bad.join(', ')}`);
    return codes.map(Number);
};

/**
 * Хиты: продажи из всех источников складываются по коду. Считаются документы, а не штуки — иначе наверх уйдёт
 * то, что берут сотнями. Не меньше minSales, есть в магазине. Продажи по убыванию, при равенстве — штуки.
 */
export const buildHitsList = (
    rows: ShowcaseSales[],
    inStock: Set<string>,
    minSales = HITS_MIN_SALES,
    limit = SHOWCASE_LIMIT,
): string[] => {
    const total = new Map<string, { sales: number; pieces: number }>();
    for (const r of rows) {
        const t = total.get(r.code) ?? { sales: 0, pieces: 0 };
        t.sales += r.sales;
        t.pieces += r.pieces;
        total.set(r.code, t);
    }
    return firstUnique(
        [...total]
            .filter(([code, t]) => inStock.has(code) && t.sales >= minSales)
            .sort(([ca, a], [cb, b]) => b.sales - a.sales || b.pieces - a.pieces || byCode(ca, cb))
            .map(([code]) => code),
        limit,
    );
};

/** Скидка от зачёркнутой цены, 0..1. Без зачёркнутой или она не выше цены — 0. */
export const dealDiscount = (p: ShowcaseDealPrice): number =>
    p.originalPrice > 0 && p.originalPrice > p.price ? (p.originalPrice - p.price) / p.originalPrice : 0;

/** Лучшие предложения: только со скидкой и в наличии. Скидка по убыванию, при равенстве — по коду. */
export const buildDealsList = (prices: ShowcaseDealPrice[], inStock: Set<string>, limit = SHOWCASE_LIMIT): string[] =>
    firstUnique(
        prices
            .filter((p) => inStock.has(p.code) && dealDiscount(p) > 0)
            .sort((a, b) => dealDiscount(b) - dealDiscount(a) || byCode(a.code, b.code))
            .map((p) => p.code),
        limit,
    );
