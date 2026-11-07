import { WbTransactionDto } from '../dto/wb.transaction.dto';

export function financialId(value: unknown, label: string): number {
    if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        String(value).trim() === '' ||
        !/^\d+$/.test(String(value)) ||
        !Number.isSafeInteger(Number(value))
    )
        throw new Error(`ВБ: некорректный ${label}`);
    return Number(value);
}
function money(value: unknown, label: string): number {
    if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        !/^-?\d+(?:\.\d+)?$/.test(String(value)) ||
        !Number.isFinite(Number(value))
    )
        throw new Error(`ВБ: некорректная сумма ${label}`);
    return Number(value);
}
/** https://dev.wildberries.ru/api/swagger/yaml/ru/13-finances.yaml
 * Явное соответствие официальной схеме; новые денежные поля приходят строками.
 * Исходная строка сохраняется для последующей сверки расходов и компенсаций.
 */
export function normalizeFinancialRow(raw: Record<string, unknown>): WbTransactionDto {
    if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        typeof raw.orderDt !== 'string' ||
        typeof raw.srid !== 'string'
    )
        throw new Error('ВБ: некорректная строка финансового отчёта');
    const id = financialId(raw.rrdId, 'rrdId');
    if (!id) throw new Error('ВБ: rrdId должен быть положительным');
    return {
        order_dt: raw.orderDt,
        srid: raw.srid,
        rrd_id: id,
        assembly_id: financialId(raw.orderId, 'orderId'),
        sticker_id: raw.stickerId == null ? undefined : String(raw.stickerId),
        delivery_rub: money(raw.deliveryService, 'deliveryService'),
        ppvz_for_pay: money(raw.forPay, 'forPay'),
        additional_payment: money(raw.additionalPayment, 'additionalPayment'),
        penalty: money(raw.penalty, 'penalty'),
        raw: { ...raw },
    };
}
