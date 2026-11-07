import { AccrualDto, AccrualTypeDto } from '../../posting/dto/accrual.dto';
import { lossDate, lossOfferKey, LossPeriod, MarketplaceLossRow, RecordedWriteOff } from './marketplace.loss.stats';
import { uniqueAccruals, ozonSkuOf } from './ozon.accrual.normalizer';
import { ozonPostingSkuKey } from './ozon.return.evidence';
import { LossExpenseTotals } from '../../marketplace-loss/loss-expenses';
import { lossMoneyCents } from './marketplace.loss.money';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { IJobContext } from '../../interfaces/i.job.context';

export interface OzonLossFee {
    posting: string;
    sku: string | null;
    name: string;
    cents: number;
    units: number | null;
}
export const ozonSellerReturnFees = new Set([
    'SellerReturns',
    'PreparingToReturn',
    'SellerReturnPreparationByPartner',
    'SellerReturnDelivery',
]);
export const ozonReverseFees = new Set([
    'ReturnFlowLogistic',
    'BackwardShipment',
    'PickUpPointReturnAcceptance',
    'Cancellation',
    'PartialReturn',
    'ClientReturn',
]);
export const ozonForwardFees = new Set([
    'Logistic',
    'Shipment',
    'LastMile',
    'LastMileCourier',
    'LastMilePickUpPoint',
    'DeliveryToHandoverPlaceByOzon',
    'Drop-Off',
    'Drop-Off Agent',
    'Pick-Up',
]);
export const ozonCompensationFees = new Set(['ItemCompensation']);
/** Только расшифровки услуг. total_amount не складывается с уже входящими в него услугами. */
export async function readOzonLossFees(
    accruals: AccrualDto[],
    types: AccrualTypeDto[],
    period: LossPeriod,
    context?: IJobContext,
): Promise<OzonLossFee[]> {
    const names = new Map<number, string>();
    for (const type of types) {
        if (!Number.isSafeInteger(type.id) || typeof type.name !== 'string' || !type.name || names.has(type.id))
            throw new Error('Неоднозначный словарь начислений Ozon');
        names.set(type.id, type.name);
    }
    if (!names.size) throw new Error('Нет словаря начислений Ozon');
    const from = lossDate(period.from),
        to = lossDate(period.to);
    const fees: OzonLossFee[] = [];
    const add = (accrual: AccrualDto, sku: unknown, units: unknown, fee: any) => {
        const name = names.get(fee?.type_id);
        if (!name) throw new Error(`Неизвестный вид начисления Ozon ${fee?.type_id}`);
        if (
            !(
                ozonSellerReturnFees.has(name) ||
                ozonReverseFees.has(name) ||
                ozonForwardFees.has(name) ||
                ozonCompensationFees.has(name)
            )
        )
            return;
        const money = fee.accrued;
        if (money?.currency !== 'RUB' || typeof money.amount !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(money.amount))
            throw new Error('Некорректная сумма услуги Ozon');
        const value = Number(money.amount);
        fees.push({
            posting: accrual.unit_number?.trim() ?? '',
            sku: sku == null ? null : ozonSkuOf(sku),
            name,
            cents: lossMoneyCents(-value),
            units: Number.isSafeInteger(units) && Number(units) > 0 ? Number(units) : null,
        });
    };
    const unique = uniqueAccruals(accruals);
    if (context) {
        context.progress.total = unique.length;
        context.progress.done = 0;
    }
    let i = 0;
    for (const accrual of unique) {
        if (i++ % 250 === 0) await jobCheckpoint(context);
        if (context) context.progress.done = i;
        const at = lossDate(accrual.date);
        if (at < from || at >= to) continue;
        for (const product of accrual.posting?.products ?? []) {
            const delivery = product.delivery as { services?: unknown[] };
            for (const fee of delivery?.services ?? []) add(accrual, product.sku, product.quantity, fee);
        }
        for (const product of accrual.item_fees?.fees ?? []) {
            for (const fee of product.fees ?? []) add(accrual, product.sku, (product as any).quantity, fee);
        }
        if (accrual.non_item_fee) add(accrual, null, null, accrual.non_item_fee);
    }
    return fees;
}
export interface OzonLossExpenseEvidence {
    offers: ReadonlyMap<string, string>;
    cancellations: ReadonlySet<string>;
    clients: ReadonlyMap<string, number>;
    unknownPostings?: ReadonlySet<string>;
}
/** Расходы отказов/вывоза — средние фактические; оплаченные возвраты остаются в политике Ozon и тарифах. */
export async function calculateOzonLossExpenses(
    fees: OzonLossFee[],
    rows: MarketplaceLossRow[],
    writeOffs: RecordedWriteOff[],
    evidence: OzonLossExpenseEvidence,
    confirmedCancelledPostings: ReadonlySet<string>,
    context?: IJobContext,
) {
    const expenses = new Map<string, LossExpenseTotals>();
    const issues: { offerId: string; reason: string }[] = [];
    const get = (offer: string) => {
        const key = lossOfferKey(offer);
        if (!expenses.has(key))
            expenses.set(key, { cancellationDelivery: 0, sellerReturnDelivery: 0, confirmedDefectCompensation: 0 });
        return expenses.get(key);
    };
    rows.forEach((row) => get(row.offerId));
    const cancelledLegs = new Map<string, { offer: string; direct: boolean; reverse: boolean }>();
    const unknown = new Set<string>();
    const issue = (offer: string, reason: string) => {
        unknown.add(lossOfferKey(offer));
        issues.push({ offerId: offer, reason });
    };
    const add = (offer: string, field: keyof LossExpenseTotals, cents: number) => {
        get(offer)[field] += cents;
        if (!Number.isSafeInteger(get(offer)[field])) throw new Error('Переполнение сумм расходов Ozon');
    };
    if (context) {
        context.progress.total = fees.length;
        context.progress.done = 0;
    }
    for (let i = 0; i < fees.length; i++) {
        if (context) context.progress.done = i + 1;
        if (i % 250 === 0) await jobCheckpoint(context);
        const fee = fees[i];
        if (!fee.sku) {
            if (ozonCompensationFees.has(fee.name)) continue; // Без связи возмещение не вычитается.
            throw new Error('Не сопоставлен товар расходов Ozon');
        }
        const offer = evidence.offers.get(fee.sku);
        if (!offer) throw new Error(`Не сопоставлен SKU расходов Ozon ${fee.sku}`);
        if (ozonSellerReturnFees.has(fee.name)) {
            add(offer, 'sellerReturnDelivery', fee.cents);
            continue;
        }
        if (ozonCompensationFees.has(fee.name)) {
            const matches = writeOffs.filter(
                (row) =>
                    row.service === 'OZON' &&
                    row.posting === fee.posting &&
                    lossOfferKey(`${row.goodscode}-${row.pieces}`) === lossOfferKey(offer),
            );
            if (matches.length === 1 && matches[0].units === fee.units)
                add(offer, 'confirmedDefectCompensation', -fee.cents);
            continue;
        }
        if (evidence.unknownPostings?.has(fee.posting)) {
            issue(offer, 'Не подтверждено основание доставки Ozon');
            continue;
        }
        const key = ozonPostingSkuKey(fee.posting, fee.sku);
        const cancelled = evidence.cancellations.has(key) || confirmedCancelledPostings.has(fee.posting);
        const client = evidence.clients.has(key);
        if (cancelled && client) {
            issue(offer, 'Неоднозначный тип возврата Ozon');
            continue;
        }
        if (client) continue; // Доставка оплаченного возврата уже начисляется общей тарифной формулой.
        if (!cancelled) {
            if (ozonReverseFees.has(fee.name)) issue(offer, 'Не подтверждено основание обратной доставки Ozon');
            continue;
        }
        add(offer, 'cancellationDelivery', fee.cents);
        if (!cancelledLegs.has(key)) cancelledLegs.set(key, { offer, direct: false, reverse: false });
        const legs = cancelledLegs.get(key);
        if (['Logistic', 'Shipment'].includes(fee.name)) legs.direct = true;
        if (['ReturnFlowLogistic', 'BackwardShipment'].includes(fee.name)) legs.reverse = true;
    }
    for (const legs of cancelledLegs.values())
        if (!legs.direct || !legs.reverse) issue(legs.offer, 'Нет обеих сторон доставки при отказе Ozon');
    for (const [offer, row] of expenses) {
        if (row.confirmedDefectCompensation < 0) throw new Error('Не подтверждён итог компенсации брака Ozon');
        for (const key of ['cancellationDelivery', 'sellerReturnDelivery', 'confirmedDefectCompensation'] as const)
            row[key] /= 100;
        if (unknown.has(offer)) row.cancellationDelivery = null;
    }
    return { expenses, issues };
}
