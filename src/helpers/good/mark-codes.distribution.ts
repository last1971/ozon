/**
 * Отбрасывание кодов маркировки под резерв.
 *
 * Код неделим: под заказ уходит целая упаковка. Поэтому резерв закрывается не штуками,
 * а целыми кодами, и с витрины снимается столько, сколько весят выбранные коды.
 * Хвост от вскрытой упаковки не публикуется — действующего КМ на него уже нет.
 */

/** Свободные коды товара: номинал → сколько кодов этого номинала. */
export type FreeCodesByNominal = Map<number, number>;

/** Сумма штук по всем кодам. */
export const sumNominals = (codes: FreeCodesByNominal): number =>
    Array.from(codes.entries()).reduce((sum, [nominal, count]) => sum + nominal * count, 0);

/**
 * Сколько штук нужно закрыть кодами:
 *   need = reserve + max(0, Σкодов − quantity)
 *
 * Первое слагаемое — резерв (заказы в сборке), второе — страховка на случай, когда кодов
 * больше учётного остатка: лишнее тоже отбрасываем, иначе продадим то, чего на складе нет.
 */
export const computeNeedToDrop = (codes: FreeCodesByNominal, quantity: number, reserve: number): number =>
    Math.max(0, (reserve ?? 0) + Math.max(0, sumNominals(codes) - (quantity ?? 0)));

/**
 * Оставшиеся коды после закрытия `need` штук.
 *
 * Выбирается подмножество с суммой ≥ need и **минимальной** суммой; при равной сумме —
 * с меньшим числом кодов. Если всех кодов не хватает — отбрасываем все (товар уйдёт в 0).
 *
 * Реализация — ограниченный рюкзак по сумме. Верхняя граница перебора `need + maxНоминал`:
 * у минимального подходящего подмножества выкидывание любого кода даёт сумму < need,
 * значит сама сумма меньше `need + maxНоминал`. Объёмы маленькие (на проде максимум
 * 8416 штук, 37 кодов, 5 разных номиналов), ускорения не нужны.
 */
export const dropCodesForNeed = (codes: FreeCodesByNominal, need: number): FreeCodesByNominal => {
    const nominals = Array.from(codes.entries())
        .filter(([nominal, count]) => nominal > 0 && count > 0)
        .sort(([a], [b]) => a - b);

    if (need <= 0) return new Map(nominals);
    if (sumNominals(new Map(nominals)) < need) return new Map<number, number>();

    const maxNominal = nominals[nominals.length - 1][0];
    const cap = need + maxNominal - 1;

    // dp[s] — минимальное число кодов, дающее ровно сумму s, и раскладка этого набора.
    type Cell = { count: number; take: number[] };
    const dp: Cell[] = new Array(cap + 1).fill(null);
    dp[0] = { count: 0, take: nominals.map(() => 0) };

    nominals.forEach(([nominal, limit], index) => {
        // Проход по возрастанию с опорой на уже обновлённые ячейки — так учитывается лимит кодов.
        for (let sum = nominal; sum <= cap; sum++) {
            const from = dp[sum - nominal];
            if (!from || from.take[index] >= limit) continue;
            if (dp[sum] && dp[sum].count <= from.count + 1) continue;
            const take = [...from.take];
            take[index] += 1;
            dp[sum] = { count: from.count + 1, take };
        }
    });

    // Минимальная достижимая сумма ≥ need; для неё dp уже держит минимум по числу кодов.
    for (let sum = need; sum <= cap; sum++) {
        if (!dp[sum]) continue;
        const remaining = new Map<number, number>();
        nominals.forEach(([nominal, count], index) => {
            const left = count - dp[sum].take[index];
            if (left > 0) remaining.set(nominal, left);
        });
        return remaining;
    }

    // Сюда не попадаем: суммы хватает (проверено выше), значит подходящий набор существует.
    return new Map<number, number>();
};

/**
 * Свободные коды товара после резерва — то, что реально можно выставить на маркет.
 */
export const freeCodesAfterReserve = (
    codes: FreeCodesByNominal,
    quantity: number,
    reserve: number,
): FreeCodesByNominal => dropCodesForNeed(codes, computeNeedToDrop(codes, quantity, reserve));

/**
 * Раскладка уцелевших кодов по фасовкам маркета.
 *
 * - номинал N, под который у товара есть фасовка `код-N` → в неё уходит **число кодов**
 *   (маркет считает фасовку упаковками, а не штуками);
 * - номинал 1 → базовая фасовка (`код` либо `код-1` — что реально заведено на сервисе);
 * - номинал без своей фасовки → его штуки (N × число кодов) уходят в базовую;
 * - фасовки, которым кодов не досталось, получают 0 — старое значение не наследуется.
 *
 * `skus` — SKU этого товара на конкретном сервисе; на разных маркетах набор фасовок разный,
 * поэтому и раскладка считается на каждый сервис отдельно.
 */
export const distributeCodesToSkus = (
    goodCode: string,
    skus: string[],
    codes: FreeCodesByNominal,
): Map<string, number> => {
    const result = new Map<string, number>(skus.map((sku) => [sku, 0]));

    // Фасовка под номинал: 1 → базовая (`код` или `код-1`), N → `код-N`.
    const skuByNominal = new Map<number, string[]>();
    for (const sku of skus) {
        const suffix = sku.slice(goodCode.length);
        const nominal = suffix === '' ? 1 : Number(suffix.replace('-', ''));
        if (!Number.isInteger(nominal) || nominal <= 0) continue;
        if (!skuByNominal.has(nominal)) skuByNominal.set(nominal, []);
        skuByNominal.get(nominal).push(sku);
    }

    const baseSkus = skuByNominal.get(1) ?? [];
    let basePieces = 0;

    for (const [nominal, count] of codes) {
        if (count <= 0) continue;
        if (nominal === 1) {
            basePieces += count;
            continue;
        }
        const own = skuByNominal.get(nominal);
        if (own) {
            // Одна фасовка = один код этого номинала.
            own.forEach((sku) => result.set(sku, count));
        } else {
            // Фасовки под такой номинал нет — штуки уходят в базовую (её вскрывают руками).
            basePieces += nominal * count;
        }
    }

    // `код` и `код-1` на одном сервисе вместе не заводятся; если всё же оба — значение одинаковое.
    baseSkus.forEach((sku) => result.set(sku, basePieces));

    return result;
};
