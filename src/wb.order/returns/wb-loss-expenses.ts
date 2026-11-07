import { lossMoneyCents as cents } from '../../helpers/price/marketplace.loss.money';
import { isDeepStrictEqual } from 'util';
import { MarketplaceLossAccumulator, lossDate, lossOfferKey } from '../../helpers/price/marketplace.loss.stats';
import { LossContext } from '../../marketplace-loss/loss.contracts';
import { LossExpenseTotals } from '../../marketplace-loss/loss-expenses';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { WbTransactionDto } from '../dto/wb.transaction.dto';
import { financialId } from '../finance/financial-row';

type Expense = Exclude<keyof LossExpenseTotals, 'confirmedDefectCompensation'>;
interface Fee {
    id: number;
    offerId: string;
    key: string;
    ground: string;
    cents: number;
}
const forward = 'К клиенту при продаже';
const reverse = 'От клиента при возврате';
const cancelOut = 'К клиенту при отмене';
const cancelBack = 'От клиента при отмене';
const seller = new Set(['Возврат брака (К продавцу)', 'Возврат товара, который приехал по МП, продавцу (К продавцу)']);
const corrections = new Set(['коррекция логистики', 'коррекция стоимости доставки']);
const orderKey = (offerId: string, orderId: string) => JSON.stringify([offerId, orderId]);
/** Основания сопоставлены со строками реального отчёта магазина.
 * Компенсация ущерба: https://seller.wildberries.ru/instructions/ru/ru/material/how-to-read-fimancial-reports-detalization
 * Вычет возможен только по ШК того же подтверждённого списания. */
export async function reconcileWbLossExpenses(ctx: LossContext, financial: WbTransactionDto[]) {
    if (ctx.service !== 'WB') throw new Error('Финансовая сверка ВБ для другой площадки');
    const stats = new MarketplaceLossAccumulator(ctx.period, 'WB');
    const issues: { offerId: string; reason: string }[] = [];
    const expenses = new Map<string, LossExpenseTotals>();
    const failed = new Map<string, Set<Expense>>();
    const get = (offerId: string) => {
        if (!expenses.has(offerId))
            expenses.set(offerId, {
                paidReturnDelivery: 0,
                cancellationDelivery: 0,
                sellerReturnDelivery: 0,
                confirmedDefectCompensation: 0,
            });
        return expenses.get(offerId);
    };
    const issue = (
        offerId: string,
        reason: string,
        fields: Expense[] = ['paidReturnDelivery', 'cancellationDelivery', 'sellerReturnDelivery'],
    ) => {
        issues.push({ offerId, reason });
        if (!failed.has(offerId)) failed.set(offerId, new Set());
        fields.forEach((field) => failed.get(offerId).add(field));
    };
    const add = (offerId: string, field: keyof LossExpenseTotals, value: number) => {
        const row = get(offerId);
        row[field] += value;
        if (!Number.isSafeInteger(row[field])) throw new Error('ВБ: переполнение сумм расходов');
    };
    const expected = new Map<string, { offerId: string; sale: number; return: number }>();
    for (let i = 0; i < ctx.sales.length; i++) {
        stats.addOperation(ctx.sales[i]);
        if (i % 500 === 0) await jobCheckpoint(ctx);
    }
    for (const op of stats.operationsInPeriod()) {
        get(op.offerId);
        const key = orderKey(op.offerId, op.orderId);
        if (!expected.has(key)) expected.set(key, { offerId: op.offerId, sale: 0, return: 0 });
        expected.get(key)[op.kind] += op.units;
    }
    const writeOffs = new Map<string, (typeof ctx.writeOffs)[number]>();
    for (const row of ctx.writeOffs) {
        stats.addWriteOff(row); // Подтверждение документа и дедупликация — существующий общий алгоритм.
        if (lossDate(row.spisAt) < lossDate(ctx.period.from) || lossDate(row.spisAt) >= lossDate(ctx.period.to))
            continue;
        const offer = lossOfferKey(`${row.goodscode}-${row.pieces}`);
        get(offer);
        if (!row.extId) continue; // Без связи с ШК компенсацию не вычитаем.
        const key = String(row.extId);
        const previous = writeOffs.get(key);
        if (previous && previous.id !== row.id) throw new Error('ВБ: неоднозначная связь компенсации со списанием');
        writeOffs.set(key, row);
    }
    const actual = new Map<string, { offerId: string; sale: number; return: number }>();
    const seen = new Map<number, WbTransactionDto>();
    const fees: Fee[] = [];
    const compensations: { offerId: string; cents: number }[] = [];
    const from = lossDate(ctx.period.from),
        to = lossDate(ctx.period.to);
    ctx.progress.total = financial.length;
    ctx.progress.done = 0;
    for (const row of financial) {
        if (ctx.progress.done++ % 500 === 0) await jobCheckpoint(ctx);
        const id = financialId(row.rrd_id, 'rrdId');
        const previous = seen.get(id);
        if (previous) {
            if (!isDeepStrictEqual(previous, row)) throw new Error(`ВБ: противоречивый дубль расходов ${id}`);
            continue;
        }
        seen.set(id, row);
        const raw = row.raw;
        if (!raw || typeof raw.rrDate !== 'string') throw new Error('ВБ: нет исходной строки/даты финансовой операции');
        const at = lossDate(raw.rrDate);
        if (at < from || at >= to) continue;
        const ground = String(raw.bonusTypeName ?? '').trim();
        const operation = String(raw.sellerOperName ?? '').trim();
        const kind =
            raw.docTypeName === 'Продажа' && operation === 'Продажа'
                ? 'sale'
                : raw.docTypeName === 'Возврат' && operation === 'Возврат'
                  ? 'return'
                  : null;
        const compensation = operation === 'Компенсация ущерба';
        const compensationReview = !compensation && /компенсаци.*ущерб/i.test(operation);
        const relevant =
            kind ||
            row.delivery_rub !== 0 ||
            [forward, reverse, cancelOut, cancelBack].includes(ground) ||
            seller.has(ground) ||
            compensation ||
            compensationReview;
        if (!relevant) continue;
        const offerId = lossOfferKey(String(raw.vendorCode ?? '').trim());
        const key = orderKey(offerId, row.srid);
        get(offerId);
        if (compensationReview) issue(offerId, 'Коррекция компенсации ущерба требует проверки');
        if (kind) {
            if (!row.srid || !Number.isSafeInteger(raw.quantity) || Number(raw.quantity) < 1)
                throw new Error('ВБ: нет заказа или количества финансовой продажи/возврата');
            if (!actual.has(key)) actual.set(key, { offerId, sale: 0, return: 0 });
            actual.get(key)[kind] += Number(raw.quantity);
        }
        if (row.delivery_rub !== 0 || [forward, reverse, cancelOut, cancelBack].includes(ground) || seller.has(ground))
            fees.push({ id, offerId, key, ground, cents: cents(row.delivery_rub) });
        if (compensation) {
            const writeOff = writeOffs.get(String(raw.shkId));
            if (
                !writeOff ||
                lossOfferKey(`${writeOff.goodscode}-${writeOff.pieces}`) !== offerId ||
                (writeOff.posting && writeOff.posting !== String(raw.orderId))
            )
                continue;
            if (raw.docTypeName !== 'Продажа' || row.ppvz_for_pay < 0) {
                issue(offerId, 'Компенсация ущерба требует проверки знака/сторно');
                continue;
            }
            compensations.push({ offerId, cents: cents(row.ppvz_for_pay) });
        }
    }
    for (const key of new Set([...expected.keys(), ...actual.keys()])) {
        const a = expected.get(key),
            b = actual.get(key);
        if ((a?.sale ?? 0) !== (b?.sale ?? 0) || (a?.return ?? 0) !== (b?.return ?? 0))
            issue((a ?? b).offerId, 'Количество продаж/возвратов не подтверждено финансовым отчётом');
    }
    const categories = new Map<string, Set<Expense>>();
    const forwardFees = new Map<string, Fee[]>(),
        reverseKeys = new Set<string>();
    const cancels = new Map<string, { offerId: string; out: boolean; back: boolean }>();
    const categorize = (key: string, field: Expense) => {
        if (!categories.has(key)) categories.set(key, new Set());
        categories.get(key).add(field);
    };
    for (let i = 0; i < fees.length; i++) {
        if (i % 500 === 0) await jobCheckpoint(ctx);
        const fee = fees[i];
        if (fee.ground === forward) {
            if (!forwardFees.has(fee.key)) forwardFees.set(fee.key, []);
            forwardFees.get(fee.key).push(fee);
            // Прямая доставка оплаченного возврата — дополнительная к обычной продаже.
            if ((actual.get(fee.key)?.return ?? 0) > 0) categorize(fee.key, 'paidReturnDelivery');
        } else if (fee.ground === reverse) {
            add(fee.offerId, 'paidReturnDelivery', fee.cents);
            reverseKeys.add(fee.key);
            categorize(fee.key, 'paidReturnDelivery');
        } else if ([cancelOut, cancelBack].includes(fee.ground)) {
            add(fee.offerId, 'cancellationDelivery', fee.cents);
            categorize(fee.key, 'cancellationDelivery');
            if (!cancels.has(fee.key)) cancels.set(fee.key, { offerId: fee.offerId, out: false, back: false });
            cancels.get(fee.key)[fee.ground === cancelOut ? 'out' : 'back'] = true;
        } else if (seller.has(fee.ground)) {
            add(fee.offerId, 'sellerReturnDelivery', fee.cents);
            categorize(fee.key, 'sellerReturnDelivery');
        } else if (!corrections.has(fee.ground) && /возврат|отмен/i.test(fee.ground)) {
            issue(fee.offerId, `Неизвестное основание возвратной доставки: ${fee.ground}`);
        }
    }
    for (const [key, row] of actual) {
        if (!row.return) continue;
        const legs = forwardFees.get(key);
        if (!legs?.length || !reverseKeys.has(key))
            issue(row.offerId, 'Нет подтверждённой доставки оплаченного возврата в обе стороны', [
                'paidReturnDelivery',
            ]);
        for (const fee of legs ?? []) add(row.offerId, 'paidReturnDelivery', fee.cents);
    }
    for (const [key, cancel] of cancels) {
        if (!cancel.out || !cancel.back || (actual.get(key)?.sale ?? 0) > 0)
            issue(cancel.offerId, 'Не подтверждены обе стороны доставки при отмене', ['cancellationDelivery']);
    }
    for (const fee of fees) {
        if (!corrections.has(fee.ground)) continue;
        const fields = categories.get(fee.key);
        if (fields?.size === 1) add(fee.offerId, [...fields][0], fee.cents);
        else if (!forwardFees.has(fee.key) || fields?.size)
            issue(fee.offerId, 'Не определён вид корректируемой логистики');
        // Однозначная коррекция только обычной доставки не становится резервом возвратов.
    }
    for (const compensation of compensations)
        add(compensation.offerId, 'confirmedDefectCompensation', compensation.cents);
    for (const [offerId, row] of expenses) {
        for (const field of Object.keys(row) as (keyof LossExpenseTotals)[]) row[field] /= 100;
        for (const field of failed.get(offerId) ?? []) row[field] = null;
    }
    return { expenses, issues };
}
