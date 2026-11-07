import type { LossExpenseTotals } from './loss-expenses';
import type { IJobContext } from '../interfaces/i.job.context';
import type { LossPeriod, MarketplaceLossRow, RecordedWriteOff } from '../helpers/price/marketplace.loss.stats';

export interface LossCounts {
    offerId: string;
    soldUnits: number;
    returnedUnits: number | null;
}
export interface LossExclusion {
    goodscode: string;
    reason: string;
}
export interface LossHistoryPage {
    operations: LossOperation[];
    /** Итоги за запрошенное окно, если существующий источник уже сводит операции (Ozon). */
    counts?: LossCounts[];
    excludedGoods?: LossExclusion[];
    next: string | null;
}
export interface LossOperation {
    id: string;
    offerId: string;
    kind: 'sale' | 'return';
    units: number;
    occurredAt: string;
    changedAt: string;
    orderId: string;
}
/** Адаптер площадки возвращает единый формат, не вычисляет проценты и не пишет БД. */
export interface ILossHistorySource {
    readonly service: string;
    readonly preliminary: boolean;
    readonly returnsKnown?: boolean;
    readPage(cursor: string): Promise<LossHistoryPage>;
}
export interface ILossWriteOffSource {
    listRecordedWriteOffs(service: string, from: string, to: string): Promise<RecordedWriteOff[]>;
}
export interface LossContext extends IJobContext {
    service: string;
    preliminary: boolean;
    period: LossPeriod;
    sales: LossOperation[];
    counts?: LossCounts[];
    returnsKnown?: boolean;
    excludedGoods?: LossExclusion[];
    writeOffs: RecordedWriteOff[];
    rows: MarketplaceLossRow[];
    expenses?: Map<string, LossExpenseTotals>;
}
export interface LossSnapshot {
    service: string;
    preliminary: boolean;
    period: LossPeriod;
    calculatedAt: Date;
    rows: MarketplaceLossRow[];
}
/** Перенос старого процента не восстанавливает неизвестные количества и период. */
export interface StoredLossRow extends Omit<MarketplaceLossRow, 'soldUnits' | 'returnedUnits' | 'writtenOffUnits'> {
    soldUnits: number | null;
    returnedUnits: number | null;
    writtenOffUnits: number | null;
    state: 'MIGRATED' | 'NO_SALES' | 'READY' | 'REVIEW' | 'PARTIAL';
    calculatedAt: Date;
}
export interface StoredLossSnapshot extends Omit<LossSnapshot, 'period' | 'rows'> {
    period: LossPeriod | null;
    rows: StoredLossRow[];
}
export interface LossSaveHooks {
    checkpoint?: (done: number, total: number) => Promise<void>;
    beforeCommit?: () => Promise<void>;
}
export const LOSS_STATS_STORE = Symbol('LOSS_STATS_STORE');
export interface ILossStatsStore {
    replace(snapshot: LossSnapshot, hooks?: LossSaveHooks): Promise<void>;
    read(service: string): Promise<StoredLossSnapshot | null>;
}
export function assertLossService(service: string): void {
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(service)) throw new Error('Некорректная площадка статистики');
}
