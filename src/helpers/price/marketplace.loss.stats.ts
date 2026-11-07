import type { LossExpenseTotals } from '../../marketplace-loss/loss-expenses';
import type { LossOperation, LossCounts } from '../../marketplace-loss/loss.contracts';
import { DateTime } from 'luxon';
import { calculateOzonReturnPerc } from './ozon.return.perc';
import { ozonReturnKey } from './ozon.return.snapshot';

export interface LossPeriod {
    from: string;
    to: string;
}
export interface RecordedWriteOff {
    id: number;
    extId?: string;
    posting?: string | null;
    service: string;
    goodscode: string;
    pieces: number;
    units: number;
    quan: number;
    spisCode: number;
    spisSs: number;
    spisAt: Date;
    documentQuantity: number | null;
}
export interface MarketplaceLossRow {
    offerId: string;
    soldUnits: number;
    returnedUnits: number | null;
    writtenOffUnits: number;
    returnRate: number | null;
    defectRate: number | null;
    warnings: string[];
    /** Доля после политики площадки; собственная статистика остаётся в returnRate. */
    appliedReturnRate?: number | null;
    expenses?: LossExpenseTotals;
}

/** 90 завершённых дней по Москве — одинаковое окно продаж, возвратов и списаний. */
export function lossPeriod(now = new Date()): LossPeriod {
    const end = DateTime.fromJSDate(now, { zone: 'Europe/Moscow' }).startOf('day');
    if (!end.isValid) throw new Error('Некорректная дата расчёта');
    return { from: end.minus({ days: 90 }).toISODate(), to: end.toISODate() };
}

export function lossDate(value: unknown): number {
    const date =
        value instanceof Date
            ? DateTime.fromJSDate(value)
            : typeof value === 'string'
              ? DateTime.fromISO(value, { zone: 'Europe/Moscow' })
              : null;
    if (!date?.isValid) throw new Error('Некорректная дата операции');
    return date.toMillis();
}

export function lossOfferKey(offerId: string): string {
    const { goodscode, pieces } = ozonReturnKey(offerId);
    return pieces === 1 ? goodscode : `${goodscode}-${pieces}`;
}

interface Sale {
    id: string;
    offerId: string;
    kind: 'S' | 'R';
    at: number;
    changed: number;
    srid: string;
    units: number;
}

/** Общий учёт операций в пачках. Продажа и возврат заказа имеют разные идентификаторы. */
export class MarketplaceLossAccumulator {
    private readonly totals = new Map<string, LossCounts>();
    private readonly sales = new Map<string, Sale>();
    private readonly writeOffs = new Map<number, RecordedWriteOff>();
    private readonly documents = new Set<string>();
    private readonly from: number;
    private readonly to: number;

    constructor(
        period: LossPeriod,
        private readonly service: string,
        private readonly returnsKnown = true,
    ) {
        this.from = lossDate(period.from);
        this.to = lossDate(period.to);
        if (this.from >= this.to) throw new Error('Пустой период расчёта');
    }

    addOperation(operation: LossOperation): void {
        if (
            !operation ||
            !operation.id ||
            !operation.orderId ||
            !['sale', 'return'].includes(operation.kind) ||
            !Number.isSafeInteger(operation.units) ||
            operation.units < 1
        )
            throw new Error('Некорректная операция площадки');
        const sale: Sale = {
            id: operation.id,
            offerId: lossOfferKey(operation.offerId),
            kind: operation.kind === 'sale' ? 'S' : 'R',
            at: lossDate(operation.occurredAt),
            changed: lossDate(operation.changedAt),
            srid: operation.orderId,
            units: operation.units,
        };
        const previous = this.sales.get(sale.id);
        if (previous) {
            if (sale.changed < previous.changed) return;
            if (
                sale.changed === previous.changed &&
                (sale.offerId !== previous.offerId ||
                    sale.at !== previous.at ||
                    sale.srid !== previous.srid ||
                    sale.kind !== previous.kind ||
                    sale.units !== previous.units)
            ) {
                throw new Error(`Неоднозначная операция: ${sale.id}`);
            }
        }
        this.sales.set(sale.id, sale);
    }

    /** Источник уже отобрал окно и свёл операции; даты/идентификаторы событий не выдумываем. */
    addCounts(counts: LossCounts): void {
        calculateLossRates({ ...counts, writtenOffUnits: 0 });
        const offerId = lossOfferKey(counts.offerId);
        if (this.totals.has(counts.offerId)) throw new Error('Повтор строки итогов');
        this.totals.set(counts.offerId, { ...counts, offerId });
    }

    addWriteOff(row: RecordedWriteOff): void {
        if (row.service !== this.service) throw new Error('Списание другой площадки в отчёте');
        const at = lossDate(row.spisAt);
        if (at < this.from || at >= this.to) return;
        if (
            ![row.id, row.pieces, row.units, row.quan, row.spisCode].every((n) => Number.isSafeInteger(n) && n > 0) ||
            ![0, 1].includes(row.spisSs) ||
            row.quan !== row.units * row.pieces ||
            row.documentQuantity === null ||
            row.documentQuantity !== row.quan
        ) {
            throw new Error(`Списание ${row.id}: документ или количество не подтверждены`);
        }
        lossOfferKey(`${row.goodscode}-${row.pieces}`);
        const previous = this.writeOffs.get(row.id);
        if (previous) {
            if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`Неоднозначное списание ${row.id}`);
            return;
        }
        const document = `${row.spisSs}:${row.spisCode}:${row.goodscode}`;
        if (this.documents.has(document)) throw new Error(`Повтор документа списания ${row.spisCode}`);
        this.documents.add(document);
        this.writeOffs.set(row.id, row);
    }

    /** Те же исправленные операции и то же окно для финансовой сверки; алгоритм дедупликации общий. */
    operationsInPeriod(): ReadonlyArray<Pick<LossOperation, 'offerId' | 'kind' | 'units' | 'orderId'>> {
        return [...this.sales.values()]
            .filter((sale) => sale.at >= this.from && sale.at < this.to)
            .map((sale) => ({
                offerId: sale.offerId,
                kind: sale.kind === 'S' ? 'sale' : 'return',
                units: sale.units,
                orderId: sale.srid,
            }));
    }

    result(): MarketplaceLossRow[] {
        const rows = new Map<string, MarketplaceLossRow>();
        const get = (offerId: string) => {
            if (!rows.has(offerId))
                rows.set(offerId, {
                    offerId,
                    soldUnits: 0,
                    returnedUnits: this.returnsKnown ? 0 : null,
                    writtenOffUnits: 0,
                    returnRate: null,
                    defectRate: null,
                    warnings: [],
                });
            return rows.get(offerId);
        };
        for (const item of this.totals.values()) {
            const row = get(item.offerId);
            row.soldUnits += item.soldUnits;
            row.returnedUnits =
                row.returnedUnits === null || item.returnedUnits === null
                    ? null
                    : row.returnedUnits + item.returnedUnits;
        }
        for (const sale of this.sales.values()) {
            if (sale.at < this.from || sale.at >= this.to) continue;
            const row = get(sale.offerId);
            if (sale.kind === 'S') row.soldUnits += sale.units;
            else if (row.returnedUnits !== null) row.returnedUnits += sale.units;
        }
        for (const item of this.writeOffs.values())
            get(lossOfferKey(`${item.goodscode}-${item.pieces}`)).writtenOffUnits += item.units;
        for (const row of rows.values()) Object.assign(row, calculateLossRates(row));
        return [...rows.values()].sort((a, b) => a.offerId.localeCompare(b.offerId));
    }
}

/** Единая формула и статусы отчёта/сохранения для всех площадок. */
export function calculateLossRates(
    counts: Pick<MarketplaceLossRow, 'soldUnits' | 'returnedUnits' | 'writtenOffUnits'>,
) {
    const { soldUnits, returnedUnits, writtenOffUnits } = counts;
    const returned =
        returnedUnits === null ? null : calculateOzonReturnPerc({ soldUnits, paidReturnUnits: returnedUnits });
    const defect = calculateOzonReturnPerc({ soldUnits, paidReturnUnits: writtenOffUnits });
    const warnings: string[] = [];
    if (returnedUnits === null) warnings.push('Возвраты не загружены: процент возвратов неизвестен');
    if (!soldUnits) warnings.push('Нет продаж: проценты не определены');
    else if (returned > 1 || defect > 1)
        warnings.push('Потери превышают продажи периода: требуется проверка перед применением к ценам');
    return { returnRate: soldUnits ? returned : null, defectRate: soldUnits ? defect : null, warnings };
}
