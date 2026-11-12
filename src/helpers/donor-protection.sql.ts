import { RETURN_STATE, TOWARDS_SELLER_STATES } from '../mp-decision/mp-decision.types';

/** Привязанные марки, которые ещё должны обеспечиваться подбором, включая TT=0. */
export const boundMarkCodeFilter = (m = 'm'): string =>
    `${m}.REALPRICEFCODE IS NULL AND ${m}.SHOPLOGCODE IS NULL AND ${m}.SPISID IS NULL ` +
    `AND ${m}.SPISSKLADCODE IS NULL AND ${m}.SPISSHOPCODE IS NULL`;

/**
 * Возврат к нам блокирует донора до однозначного нового наблюдения «на складе маркета».
 * Сопоставляем одну заявку: SERVICE + KIND + EXT_ID + POSTING. Другая заявка, ничья
 * по времени или более позднее неизвестное состояние не разрешают повторную продажу.
 * LAST_SEEN отражает последнее наблюдение: FIRST_SEEN не меняется при повторном входе
 * в уже известное состояние. eventSource — только доверенное имя таблицы/CTE, не ввод пользователя.
 */
export const sellerReturnExistsSql = (invoice = 's', eventSource = 'MP_EVENT'): string =>
    `EXISTS (SELECT 1 FROM ${eventSource} e WHERE e.POSTING = ` +
    `SUBSTRING(${invoice}.PRIM FROM 1 FOR POSITION(' ' IN ${invoice}.PRIM || ' ') - 1) ` +
    `AND e.SERVICE IN ('WB', 'OZON') AND e.KIND = 'RETURN' AND e.STATE IN (` +
    TOWARDS_SELLER_STATES.map((state) => `'${state}'`).join(', ') +
    `) AND NOT EXISTS (SELECT 1 FROM ${eventSource} market ` +
    'WHERE market.SERVICE = e.SERVICE AND market.KIND = e.KIND ' +
    'AND market.EXT_ID = e.EXT_ID AND market.POSTING = e.POSTING ' +
    `AND market.STATE = '${RETURN_STATE.ARRIVED_AT_MARKETPLACE}' ` +
    'AND COALESCE(market.LAST_SEEN, market.FIRST_SEEN) > COALESCE(e.LAST_SEEN, e.FIRST_SEEN) ' +
    `AND NOT EXISTS (SELECT 1 FROM ${eventSource} observed ` +
    'WHERE observed.SERVICE = market.SERVICE AND observed.KIND = market.KIND ' +
    'AND observed.EXT_ID = market.EXT_ID AND observed.POSTING = market.POSTING ' +
    'AND observed.STATE <> market.STATE ' +
    'AND COALESCE(observed.LAST_SEEN, observed.FIRST_SEEN) >= COALESCE(market.LAST_SEEN, market.FIRST_SEEN))))';

/** Сверка каждой партии марки с FIFO её строки, на собственной стороне склада/магазина. */
export const donorPartyCoverageSql = (
    marks = 'MARKCODES',
    parties = 'PR_META',
    picks = 'PODBPOS',
    fifo = 'FIFO_T',
): string =>
    'SELECT m.REALPRICECODE, m.PR_META_IN_ID, m.GOODSCODE AS MARK_GOOD, ' +
    'party.GOODSCODE AS PARTY_GOOD, party.P_R AS PARTY_TYPE, party.S_S AS PARTY_STORAGE, ' +
    'SUM(COALESCE(m.QUANTITY, 1)) AS MARK_QUANTITY, ' +
    `(SELECT COALESCE(SUM(f.QUAN), 0) FROM ${fifo} f ` +
    `JOIN ${parties} po ON po.ID = f.PR_META_OUT_ID ` +
    `JOIN ${picks} pp ON pp.PODBPOSCODE = po.PODBPOSCODE ` +
    'WHERE pp.REALPRICECODE = m.REALPRICECODE AND po.P_R = 1 ' +
    'AND po.S_S = party.S_S AND f.PR_META_IN_ID = m.PR_META_IN_ID) AS FIFO_QUANTITY ' +
    `FROM ${marks} m LEFT JOIN ${parties} party ON party.ID = m.PR_META_IN_ID ` +
    `WHERE m.REALPRICECODE IN (?, ?) AND ${boundMarkCodeFilter()} ` +
    'GROUP BY m.REALPRICECODE, m.PR_META_IN_ID, m.GOODSCODE, party.GOODSCODE, party.P_R, party.S_S';
