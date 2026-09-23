/**
 * ГДЕ у приходной партии лежит ГТД — одно правило на все команды-источники.
 *
 * Партия ссылается либо на складской приход (SKLADIN.GTD), либо на магазинный
 * (SHOPIN → SHOPINPR.GTD); заполнено ровно одно из полей, поэтому COALESCE однозначен
 * и это ОДИН источник, а не два по приоритету.
 *
 * Ветка по инстансу (getStorageSS) здесь НЕ годится и была багом: на опте лежат партии
 * с магазинным приходом. Кейс 22.09.2026 — заказ 0286132473-0001-1, товар 543341,
 * партия PR_META 2706017 (SKLADINCODE пуст, SHOPINCODE 332076, ГТД 10221010/131117/0056818).
 *
 * @param pin алиас строки PR_META (прихода) в запросе
 */
export const receiptGtdExpr = (pin: string): string =>
    `COALESCE((SELECT sk.GTD FROM SKLADIN sk WHERE sk.SKLADINCODE = ${pin}.SKLADINCODE), ` +
    '(SELECT sp.GTD FROM SHOPIN si JOIN SHOPINPR sp ON sp.SHOPINPRCODE = si.SHOPINPRCODE ' +
    `WHERE si.SHOPINCODE = ${pin}.SHOPINCODE))`;
