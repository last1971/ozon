import { AccrualCategory, AccrualDto } from '../posting/dto/accrual.dto';

/** Полный номер отправления: заказ + суффикс отправления, например 0108189587-0181-1. */
const POSTING_NUMBER = /^\d+-\d+-\d+$/;
/** Номер заказа без суффикса: 0108189587-0181. Заказ может дать несколько отправлений. */
const ORDER_NUMBER = /^\d+-\d+$/;

/** Доля начисления, ушедшая в конкретный счёт. */
export interface AccrualPart {
    accrualId: number;
    /** Сумма именно этой доли: у записи заказа, поделённой между отправлениями, — часть. */
    amount: number;
}

/** Счёт к закрытию: одно «тело» продажи со всем, что к нему привязано. */
export interface AccrualSettlement {
    /** Полный номер отправления — по нему ищется счёт (точное равенство S.PRIM). */
    postingNumber: string;
    /** Сумма к проводке: тело плюс отдельные записи отправления и доля от заказа. */
    amount: number;
    /**
     * Из чего сложилась сумма. Одна запись журнала может попасть в два счёта:
     * списание на заказ делится между его отправлениями, поэтому связь не «запись →
     * счёт», а «запись → доли». Журнал по ним помечается разнесённым.
     */
    parts: AccrualPart[];
}

export interface AccrualDistribution {
    /** Счета к закрытию — по одному на тело. */
    settlements: AccrualSettlement[];
    /** Возвраты и невыкупы: тело отрицательное либо его нет вовсе. Считаются отдельно. */
    returns: AccrualDto[];
    /** Тело ещё не пришло — записи остаются в журнале ждать следующего прогона. */
    pending: AccrualDto[];
    /** Ни к чему не привязано (реклама, продвижение бренда) — в письмо. */
    unattributed: AccrualDto[];
}

const amountOf = (a: AccrualDto): number => parseFloat(a.total_amount?.amount ?? '0') || 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const unitOf = (a: AccrualDto): string => (a.unit_number || '').trim();
const orderOf = (postingNumber: string): string => postingNumber.slice(0, postingNumber.lastIndexOf('-'));

/** Вид номера в начислении — им же размечается журнал (OZON_ACCRUAL.UNIT_KIND). */
export enum AccrualUnitKind {
    NONE = 0,
    ORDER = 1,
    POSTING = 2,
}

export function unitKindOf(unitNumber: string): AccrualUnitKind {
    const unit = (unitNumber || '').trim();
    if (POSTING_NUMBER.test(unit)) return AccrualUnitKind.POSTING;
    if (ORDER_NUMBER.test(unit)) return AccrualUnitKind.ORDER;
    return AccrualUnitKind.NONE;
}

/**
 * «Тело» продажи: запись POSTING с блоком commission внутри. Только у неё есть
 * seller_price и комиссия за продажу; total_amount у неё — уже нетто, комиссия
 * и доставка из него вычтены Озоном. Внутренности трогать нельзя, иначе двойной счёт.
 */
export const isBody = (a: AccrualDto): boolean =>
    a.accrued_category === AccrualCategory.POSTING && (a.posting?.products ?? []).some((p) => p.commission);

/**
 * Виды услуг внутри начисления. В письме без них видно только «NON_ITEM»,
 * а расшифровка (реклама, хранение, страховка) — то единственное, ради чего
 * это письмо и читают.
 */
export function accrualTypeIds(a: AccrualDto): number[] {
    const ids: number[] = [];
    for (const item of a.item_fees?.fees ?? []) {
        for (const fee of item.fees ?? []) if (fee.type_id) ids.push(fee.type_id);
    }
    if (a.non_item_fee?.type_id) ids.push(a.non_item_fee.type_id);
    return [...new Set(ids)];
}

/**
 * Раскладывает начисления по счетам. Драйвер — приход тела (решение владельца, 2026-08-09).
 *
 * Замер на живом кабинете за 06.07–02.08.2026: раньше тела по отправлению не приходит
 * ничего (0 записей из 598), а после тела — только сторно возврата (6 из 594). Значит
 * в момент тела сумма счёта финальна и ждать нечего. Списание, привязанное к заказу
 * целиком (эквайринг), Ozon начисляет при оплате — всегда РАНЬШЕ тела, без исключений
 * (394 заказа), поэтому к приходу тела оно уже лежит в журнале.
 *
 * На вход подаются только неразнесённые записи журнала: и скачанные в этом прогоне,
 * и осевшие в прошлых. Что не разнеслось — возвращается корзинами, ничего не теряется:
 * сумма входа равна сумме settlements + returns + pending + unattributed.
 */
export function distributeAccruals(accruals: AccrualDto[]): AccrualDistribution {
    const bodies = new Map<string, AccrualDto>(); // отправление → тело продажи
    const returnBodies = new Map<string, AccrualDto>(); // отправление → сторно возврата
    const byUnit = new Map<string, AccrualDto[]>(); // полный номер → прочие записи
    const byOrder = new Map<string, AccrualDto[]>(); // номер заказа → записи уровня заказа
    const unattributed: AccrualDto[] = [];

    const push = (map: Map<string, AccrualDto[]>, key: string, a: AccrualDto): void => {
        const list = map.get(key);
        if (list) list.push(a);
        else map.set(key, [a]);
    };

    for (const a of accruals) {
        const unit = unitOf(a);

        if (POSTING_NUMBER.test(unit)) {
            if (!isBody(a)) push(byUnit, unit, a);
            else if (amountOf(a) > 0) bodies.set(unit, a);
            // Отрицательное тело — сторно возврата либо невыкуп: счёт не закрываем.
            else returnBodies.set(unit, a);
        } else if (ORDER_NUMBER.test(unit)) {
            push(byOrder, unit, a);
        } else {
            unattributed.push(a);
        }
    }

    const settlements: AccrualSettlement[] = [];
    const parts = new Map<string, AccrualPart[]>();
    for (const [postingNumber, body] of bodies) {
        parts.set(postingNumber, [{ accrualId: body.accrual_id, amount: amountOf(body) }]);
    }

    // Отдельные записи отправления: услуги, не вошедшие в тело (продвижение бренда и пр.).
    const returns: AccrualDto[] = [...returnBodies.values()];
    const pending: AccrualDto[] = [];
    for (const [unit, list] of byUnit) {
        const part = parts.get(unit);
        for (const a of list) {
            if (part) {
                part.push({ accrualId: a.accrual_id, amount: amountOf(a) });
            } else if (returnBodies.has(unit)) {
                returns.push(a); // обработка возврата по несостоявшейся сделке
            } else {
                // Тела нет. По самой записи невыкуп не опознать: из 186 таких отправлений
                // за 06.07–02.08 115 отменены возвратом, 22 счёта уже оплачены и закрыты,
                // а 49 живые и ждут. Судьбу решает состояние счёта, см. classifyPending.
                pending.push(a);
            }
        }
    }

    // Списание на заказ целиком делится между его отправлениями пропорционально нетто.
    // Делим только между телами текущего прогона: тело, которое приедет позже, доли
    // не получит (45 заказов из 575 дают больше одного отправления, из них 6 — в разных
    // неделях). Деньги при этом не теряются, распределение лишь грубее.
    for (const [order, list] of byOrder) {
        const targets = [...bodies.keys()].filter((p) => orderOf(p) === order);
        const weights = targets.map((p) => amountOf(bodies.get(p)));
        const total = weights.reduce((s, w) => s + w, 0);

        if (targets.length === 0 || total === 0) {
            const bucket = [...returnBodies.keys()].some((p) => orderOf(p) === order) ? returns : pending;
            bucket.push(...list);
            continue;
        }

        for (const a of list) {
            const sum = amountOf(a);
            let spread = 0;
            targets.forEach((p, i) => {
                // последнему достаётся остаток, иначе копейки округления теряются
                const share = i === targets.length - 1 ? round2(sum - spread) : round2((sum * weights[i]) / total);
                spread = round2(spread + share);
                parts.get(p).push({ accrualId: a.accrual_id, amount: share });
            });
        }
    }

    for (const [postingNumber, list] of parts) {
        settlements.push({
            postingNumber,
            amount: round2(list.reduce((s, p) => s + p.amount, 0)),
            parts: list,
        });
    }

    return { settlements, returns, pending, unattributed };
}

/** Что стало с ожидающей записью после сверки со счётом. */
export enum PendingVerdict {
    /** Счёт живой, тела ещё нет — запись остаётся в журнале до следующего прогона. */
    WAITING = 'WAITING',
    /** Счёт переименован отменой или возвратом — ждать нечего, считается отдельно. */
    RETURNED = 'RETURNED',
    /** Счёт уже оплачен и закрыт: запись опоздала, в него её не добавить. В отчёт. */
    CLOSED = 'CLOSED',
    /** Счёта по номеру нет вовсе — в отчёт. */
    NO_INVOICE = 'NO_INVOICE',
    /** Счёт живой, но запись висит дольше порога — в отчёт, из журнала не убираем. */
    STALE = 'STALE',
}

/**
 * Состояние счёта по номеру отправления: отдаёт слой, который видит таблицу S.
 * Пометки дописываются к PRIM, поэтому «нет точного совпадения» само по себе
 * ничего не значит — важно, какая именно пометка.
 */
export interface InvoiceState {
    /** Есть счёт с PRIM ровно равным номеру отправления — живой, ждёт оплаты. */
    exact: boolean;
    /** PRIM переименован отменой или возвратом. */
    cancelled: boolean;
    /** PRIM переименован в «… закрыт»: счёт оплачен и закрыт. */
    closed: boolean;
}

export interface PendingClassification {
    verdict: PendingVerdict;
    accrual: AccrualDto;
    /** Номер отправления, по которому смотрели счёт. У записей заказа пусто. */
    postingNumber: string;
}

/**
 * Разбирает ожидающие записи по состоянию счёта.
 *
 * Форма начисления невыкуп не доказывает: POSTING без commission приходит и по
 * несостоявшейся сделке, и по той, чьё тело ещё в пути. Замер 06.07–02.08.2026:
 * из 186 отправлений с услугами, но без тела 115 отменены возвратом, 22 счёта уже
 * оплачены и закрыты, а 49 живые в статусе 4 — часть из них тело ещё получит.
 * Поэтому решает база.
 *
 * Записи уровня заказа к одному счёту не привязать, они просто ждут своего тела,
 * пока не упрутся в порог давности.
 */
export function classifyPending(
    pending: AccrualDto[],
    invoices: Map<string, InvoiceState>,
    options: { today: string; staleAfterDays?: number },
): PendingClassification[] {
    const staleAfterDays = options.staleAfterDays ?? 21;
    const today = Date.parse(options.today);

    return pending.map((accrual) => {
        const unit = unitOf(accrual);
        const postingNumber = POSTING_NUMBER.test(unit) ? unit : '';
        const state = postingNumber ? invoices.get(postingNumber) : undefined;
        const stale = (today - Date.parse(accrual.date)) / 86400000 > staleAfterDays;

        let verdict: PendingVerdict;
        if (state?.exact) verdict = stale ? PendingVerdict.STALE : PendingVerdict.WAITING;
        else if (state?.cancelled) verdict = PendingVerdict.RETURNED;
        else if (state?.closed) verdict = PendingVerdict.CLOSED;
        else if (postingNumber) verdict = PendingVerdict.NO_INVOICE;
        else verdict = stale ? PendingVerdict.STALE : PendingVerdict.WAITING;

        return { verdict, accrual, postingNumber };
    });
}
