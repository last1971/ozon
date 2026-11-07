import { Inject, Injectable } from '@nestjs/common';
import { IJobCommand } from '../interfaces/i.job.context';
import { jobCheckpoint } from '../job/job.checkpoint';
import { MarketplaceLossAccumulator, calculateLossRates } from '../helpers/price/marketplace.loss.stats';
import {
    ILossHistorySource,
    ILossWriteOffSource,
    ILossStatsStore,
    LossContext,
    LossSnapshot,
    assertLossService,
    LOSS_STATS_STORE,
} from './loss.contracts';

@Injectable()
export class LoadLossHistoryCommand implements IJobCommand<LossContext> {
    readonly phase = 'Продажи и возвраты';
    readonly weight = 70;
    constructor(private readonly source: ILossHistorySource) {}
    async execute<T extends LossContext>(ctx: T): Promise<T> {
        assertLossService(this.source.service);
        if (ctx.service !== this.source.service) throw new Error('Источник другой площадки');
        ctx.preliminary = this.source.preliminary;
        ctx.returnsKnown = this.source.returnsKnown !== false;
        let cursor = ctx.period.from;
        const seen = new Set([cursor]);
        for (let page = 0; page < 100; page++) {
            await jobCheckpoint(ctx);
            const result = await this.source.readPage(cursor);
            await jobCheckpoint(ctx);
            if (!result || !Array.isArray(result.operations)) throw new Error('Некорректная страница операций');
            if (result.next !== null && (typeof result.next !== 'string' || !result.next || seen.has(result.next)))
                throw new Error('Повторный или некорректный курсор продаж');
            if (result.excludedGoods?.length) {
                ctx.excludedGoods ??= [];
                ctx.excludedGoods.push(...result.excludedGoods);
                ctx.preliminary = true;
            }
            if (result.counts !== undefined) {
                if (!Array.isArray(result.counts)) throw new Error('Некорректные итоги операций');
                ctx.counts ??= [];
                for (const row of result.counts) {
                    ctx.counts.push(row);
                    ctx.progress.done++;
                    if (ctx.progress.done % 500 === 0) await jobCheckpoint(ctx);
                }
            }
            for (let i = 0; i < result.operations.length; i++) {
                ctx.sales.push(result.operations[i]);
                ctx.progress.done++;
                if (i % 500 === 0) await jobCheckpoint(ctx);
            }
            if (result.next === null) {
                ctx.progress.total = ctx.progress.done;
                return ctx;
            }
            seen.add(result.next);
            cursor = result.next;
            ctx.progress.counters.pages = page + 1;
        }
        throw new Error('Превышен лимит страниц; отчёт не сформирован');
    }
}
@Injectable()
export class LoadLossWriteOffsCommand implements IJobCommand<LossContext> {
    readonly phase = 'Подтверждённые списания';
    readonly weight = 10;
    constructor(private readonly source: ILossWriteOffSource) {}
    async execute<T extends LossContext>(ctx: T): Promise<T> {
        await jobCheckpoint(ctx);
        ctx.writeOffs = await this.source.listRecordedWriteOffs(ctx.service, ctx.period.from, ctx.period.to);
        await jobCheckpoint(ctx);
        ctx.progress.done = ctx.progress.total = ctx.writeOffs.length;
        return ctx;
    }
}
@Injectable()
export class CalculateLossReportCommand implements IJobCommand<LossContext> {
    readonly phase = 'Расчёт процентов';
    readonly weight = 20;
    async execute<T extends LossContext>(ctx: T): Promise<T> {
        const stats = new MarketplaceLossAccumulator(ctx.period, ctx.service, ctx.returnsKnown !== false);
        ctx.progress.total = ctx.sales.length + ctx.writeOffs.length + (ctx.counts?.length ?? 0);
        if (ctx.sales.length && ctx.counts?.length) throw new Error('Нельзя смешивать операции и готовые итоги');
        for (const row of ctx.counts ?? []) {
            stats.addCounts(row);
            if (++ctx.progress.done % 500 === 0) await jobCheckpoint(ctx);
        }
        for (const sale of ctx.sales) {
            stats.addOperation(sale);
            if (++ctx.progress.done % 500 === 0) await jobCheckpoint(ctx);
        }
        for (const row of ctx.writeOffs) {
            stats.addWriteOff(row);
            if (++ctx.progress.done % 100 === 0) await jobCheckpoint(ctx);
        }
        await jobCheckpoint(ctx);
        const excluded = new Set((ctx.excludedGoods ?? []).map((r) => r.goodscode));
        ctx.rows = stats.result().filter((r) => !excluded.has(r.offerId.split('-')[0]));
        ctx.progress.counters.excludedGoods = excluded.size;
        Object.assign(ctx.progress.counters, {
            offers: ctx.rows.length,
            withReturns: ctx.rows.filter((r) => r.returnedUnits > 0).length,
            withWriteOffs: ctx.rows.filter((r) => r.writtenOffUnits > 0).length,
            noSales: ctx.rows.filter((r) => !r.soldUnits).length,
            warnings: ctx.rows.filter((r) => r.warnings.length).length,
        });
        ctx.sales = [];
        ctx.counts = [];
        ctx.writeOffs = [];
        return ctx;
    }
}
export interface SaveLossContext extends LossContext {
    calculatedAt: Date;
    committing?: boolean;
}
/** Единая запись снимка; исполнитель должен запрещать отмену после beforeCommit. */
@Injectable()
export class SaveLossSnapshotCommand implements IJobCommand<SaveLossContext> {
    readonly phase = 'Сохранение статистики';
    readonly weight = 20;
    constructor(@Inject(LOSS_STATS_STORE) private readonly store: ILossStatsStore) {}
    async execute<T extends SaveLossContext>(ctx: T): Promise<T> {
        await jobCheckpoint(ctx);
        const snapshot: LossSnapshot = {
            service: ctx.service,
            preliminary: ctx.preliminary,
            period: ctx.period,
            calculatedAt: ctx.calculatedAt,
            rows: ctx.rows,
        };
        await this.store.replace(snapshot, {
            checkpoint: async (done, total) => {
                ctx.progress.done = done;
                ctx.progress.total = total;
                await jobCheckpoint(ctx);
            },
            beforeCommit: async () => {
                await jobCheckpoint(ctx);
                ctx.committing = true;
            },
        });
        return ctx;
    }
}

/** Присоединяет проверенные суммы; товар с расходами без продаж также не теряется. */
@Injectable()
export class ApplyLossExpensesCommand implements IJobCommand<LossContext> {
    readonly phase = 'Расходы на потери';
    readonly weight = 10;
    async execute<T extends LossContext>(ctx: T): Promise<T> {
        if (!ctx.expenses) throw new Error('Не загружены расходы площадки');
        const rows = new Map(ctx.rows.map((row) => [row.offerId, row]));
        const excluded = new Set((ctx.excludedGoods ?? []).map((row) => row.goodscode));
        ctx.progress.total = ctx.expenses.size;
        for (const [offerId, expenses] of ctx.expenses) {
            if (!excluded.has(offerId.split('-')[0])) {
                const row = rows.get(offerId) ?? {
                    offerId,
                    soldUnits: 0,
                    returnedUnits: 0,
                    writtenOffUnits: 0,
                    ...calculateLossRates({ soldUnits: 0, returnedUnits: 0, writtenOffUnits: 0 }),
                };
                row.expenses = expenses;
                rows.set(offerId, row);
            }
            if (++ctx.progress.done % 100 === 0) await jobCheckpoint(ctx);
        }
        ctx.rows = [...rows.values()];
        await jobCheckpoint(ctx);
        return ctx;
    }
}
