import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chunk } from 'lodash';
import { GOOD_SERVICE, IGood } from '../../interfaces/IGood';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { calculatePriceBatch } from '../../helpers/price/calculate-price-batch';
import { pricingFailureKind } from '../../helpers/price/pricing-error';
import { PriceSkip } from '../../price/price-update.report';
import { lossPriceRetryDue } from './loss-price.retry';
import { lossOfferKey } from '../../helpers/price/marketplace.loss.stats';
import { LossPriceQueueStore } from './loss-price-queue.store';
import { LossPriceContext, LossPricePayload, LossPriceTask, LossPriceResult } from './loss-price.contracts';

const valid = (ctx: LossPriceContext) => ctx.tasks.filter((t) => !t.error);
const targets = (ctx: LossPriceContext) => valid(ctx).flatMap((t) => t.targets);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
function rejectOffers(ctx: LossPriceContext, results: Map<string, LossPriceResult>) {
    for (const task of valid(ctx)) {
        const errors = task.targets
            .map((t) =>
                results.has(t.offer_id)
                    ? results.get(t.offer_id)
                    : { message: 'Нет подтверждения площадки', kind: 'temporary' as const },
            )
            .filter(Boolean)
            .map((failure) => (typeof failure === 'string' ? { message: failure, kind: 'data' as const } : failure));
        if (errors.length) {
            task.error = errors.map((failure) => failure.message).join('; ');
            task.failureKind = errors.some((failure) => failure.kind === 'temporary') ? 'temporary' : 'data';
        }
    }
}

@Injectable()
export class LoadLossPriceTasksCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Чтение очереди цен';
    readonly weight = 1;
    constructor(private readonly queue: LossPriceQueueStore) {}
    async execute(ctx: LossPriceContext) {
        const rows = await this.queue.pending(ctx.service);
        const grouped = new Map<string, LossPriceTask>();
        ctx.progress.total = rows.length;
        for (let i = 0; i < rows.length; i++) {
            if (i % 50 === 0) await jobCheckpoint(ctx);
            const event = rows[i];
            try {
                const payload = event.payload as LossPricePayload;
                const offerId = lossOfferKey(payload?.offerId);
                const at = Date.parse(payload?.calculatedAt);
                if (payload?.version !== 1 || !Number.isFinite(at) || event.extId !== `${at}:${offerId}`)
                    throw new Error('Некорректная версия задания');
                const task = grouped.get(offerId) ?? { offerId, events: [], targets: [], changed: [] };
                task.events.push(event);
                grouped.set(offerId, task);
            } catch (e) {
                grouped.set(event.extId, {
                    offerId: event.extId,
                    events: [event],
                    targets: [],
                    changed: [],
                    error: `Повреждённое задание: ${reason(e)}`,
                    failureKind: 'data',
                });
            }
            ctx.progress.done++;
        }
        ctx.tasks = [...grouped.values()];
        for (const task of ctx.tasks) {
            if (task.events.some((event) => lossPriceRetryDue(event.payload, ctx.forceRetry, ctx.wake))) continue;
            task.deferred = true;
            task.error =
                (task.events[task.events.length - 1].payload as LossPricePayload)?.lastError ||
                'Ожидание следующего повтора';
        }
        ctx.progress.counters.deferred = ctx.tasks.filter((task) => task.deferred).length;
        ctx.progress.counters.tasks = ctx.tasks.length;
        return ctx;
    }
}

@Injectable()
export class CalculateLossPriceTargetsCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Расчёт актуальных цен';
    readonly weight = 4;
    constructor(@Inject(GOOD_SERVICE) private readonly goods: IGood) {}
    async execute(ctx: LossPriceContext) {
        if (!valid(ctx).length) return ctx;
        const offers = new Map<string, string[]>();
        for (const offer of new Set(await ctx.adapter.offers())) {
            try {
                const key = lossOfferKey(offer);
                offers.set(key, [...(offers.get(key) ?? []), offer]);
            } catch {
                /* Артикулы другого формата не привязываются к числовому коду статистики. */
            }
        }
        const requested = new Map<string, LossPriceTask>();
        for (const task of valid(ctx)) {
            const actual = offers.get(task.offerId);
            if (!actual?.length) {
                task.error = 'Товар этой фасовки не найден в кабинете';
                task.failureKind = 'data';
                continue;
            }
            actual.forEach((offer) => requested.set(offer, task));
        }
        ctx.progress.total = requested.size;
        for (const batch of chunk([...requested.keys()], 100)) {
            await jobCheckpoint(ctx);
            try {
                const skipped = new Map<string, PriceSkip>();
                const inputs = await this.goods.buildPriceables(ctx.adapter.pricing, batch, undefined, (row) =>
                    skipped.set(row.offer_id, row),
                );
                const found = new Map(inputs.map((input) => [input.offer_id, input]));
                if (found.size !== inputs.length || inputs.some((input) => !batch.includes(input.offer_id)))
                    throw new Error('Повторный или посторонний артикул в расчёте');
                const calculated = await calculatePriceBatch(inputs, ctx.adapter.pricing.getObtainCoeffs(), ctx);
                for (const row of calculated.skipped) skipped.set(row.offer_id, row);
                const calculatedByOffer = new Map(calculated.prices.map((target) => [target.offer_id, target]));
                for (const offer of batch) {
                    const task = requested.get(offer);
                    const target = calculatedByOffer.get(offer);
                    if (!target) {
                        const failure = skipped.get(offer);
                        task.error =
                            failure?.message ||
                            (failure?.reason
                                ? `Товар не рассчитан: ${failure.reason}`
                                : 'Не все фасовки удалось рассчитать: нет базы или корректных расходов');
                        task.failureKind = failure?.failureKind ?? 'data';
                        continue;
                    }
                    task.targets.push(target);
                }
            } catch (e) {
                batch.forEach((offer) => {
                    requested.get(offer).error = reason(e);
                    requested.get(offer).failureKind = pricingFailureKind(e);
                });
            }
            ctx.progress.done += batch.length;
        }
        for (const task of ctx.tasks) if (task.error) task.targets = [];
        return ctx;
    }
}

@Injectable()
export class CompareLossPricesCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Сравнение с ценами площадки';
    readonly weight = 1;
    async execute(ctx: LossPriceContext) {
        const all = targets(ctx);
        if (!all.length) return ctx;
        const current = await ctx.adapter.current(all.map((p) => p.offer_id));
        ctx.progress.total = ctx.tasks.length;
        for (const task of ctx.tasks) {
            await jobCheckpoint(ctx);
            if (!task.error)
                try {
                    task.changed = task.targets.filter((t) => !ctx.adapter.matches(t, current.get(t.offer_id)));
                } catch (error) {
                    task.error = reason(error);
                    task.failureKind = 'data';
                }
            ctx.progress.done++;
        }
        ctx.progress.counters.unchanged = valid(ctx).reduce((n, t) => n + t.targets.length - t.changed.length, 0);
        return ctx;
    }
}

@Injectable()
export class SendLossPricesCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Отправка изменившихся цен';
    readonly weight = 2;
    async execute(ctx: LossPriceContext) {
        ctx.progress.total = valid(ctx).reduce((count, task) => count + task.changed.length, 0);
        // Сохраняем пол и при неизменившейся округлённой цене ВБ. Другие адаптеры здесь ничего не пишут.
        for (const task of valid(ctx)) {
            await jobCheckpoint(ctx);
            try {
                const unchanged = task.targets.filter((p) => !task.changed.includes(p));
                if (unchanged.length) await ctx.adapter.persist(unchanged);
            } catch (e) {
                task.error = reason(e);
                task.failureKind = pricingFailureKind(e);
            }
        }
        const changed = valid(ctx).flatMap((t) => t.changed);
        ctx.progress.total = changed.length;
        const results = new Map<string, LossPriceResult>(
            valid(ctx).flatMap((t) =>
                t.targets.filter((p) => !t.changed.includes(p)).map((p) => [p.offer_id, null] as [string, null]),
            ),
        );
        for (const batch of chunk(changed, 100)) {
            await jobCheckpoint(ctx);
            ctx.sent += batch.length;
            try {
                for (const [offer, error] of await ctx.adapter.send(batch)) results.set(offer, error);
            } catch (e) {
                batch.forEach((p) => results.set(p.offer_id, { message: reason(e), kind: pricingFailureKind(e) }));
            }
            ctx.progress.done += batch.length;
        }
        rejectOffers(ctx, results);
        ctx.progress.counters.sent = ctx.sent;
        return ctx;
    }
}

@Injectable()
export class ConfirmLossPricesCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Подтверждение цен площадкой';
    readonly weight = 1;
    constructor(private readonly config: ConfigService) {}
    async execute(ctx: LossPriceContext) {
        const all = targets(ctx);
        if (!all.length) return ctx;
        if (valid(ctx).some((t) => t.changed.length)) {
            const delay = Number(this.config.get('PRICE_VERIFY_DELAY_MS', 20000));
            await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) && delay >= 0 ? delay : 20000));
        }
        await jobCheckpoint(ctx);
        const current = await ctx.adapter.current(all.map((p) => p.offer_id));
        ctx.progress.total = ctx.tasks.length;
        for (const task of ctx.tasks) {
            await jobCheckpoint(ctx);
            if (!task.error)
                try {
                    if (task.targets.some((p) => !ctx.adapter.matches(p, current.get(p.offer_id)))) {
                        task.error = 'Площадка ещё не подтвердила рассчитанные цены; задание оставлено для повтора';
                        task.failureKind = 'temporary';
                    }
                } catch (error) {
                    task.error = reason(error);
                    task.failureKind = 'data';
                }
            ctx.progress.done++;
        }
        return ctx;
    }
}

@Injectable()
export class CheckLossPricePromosCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Проверка акций по новому минимуму';
    readonly weight = 5;
    async execute(ctx: LossPriceContext) {
        const all = targets(ctx);
        const results = new Map<string, LossPriceResult>();
        ctx.progress.total = all.length;
        for (const batch of chunk(all, ctx.adapter.promoBatchSize ?? 100)) {
            await jobCheckpoint(ctx);
            try {
                for (const [offer, error] of await ctx.adapter.promos(batch.map((p) => p.offer_id)))
                    results.set(offer, error);
            } catch (e) {
                batch.forEach((p) => results.set(p.offer_id, { message: reason(e), kind: pricingFailureKind(e) }));
            }
            ctx.progress.done += batch.length;
        }
        rejectOffers(ctx, results);
        return ctx;
    }
}

@Injectable()
export class FinishLossPriceTasksCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Фиксация результата очереди';
    readonly weight = 1;
    constructor(private readonly queue: LossPriceQueueStore) {}
    async execute(ctx: LossPriceContext) {
        ctx.progress.total = ctx.tasks.length;
        for (const task of ctx.tasks) {
            for (const event of task.events) {
                await jobCheckpoint(ctx);
                if (!task.deferred) await this.queue.finish(ctx.service, event, task.error, task.failureKind);
            }
            ctx.progress.done++;
        }
        ctx.progress.counters.completed = ctx.tasks.filter((t) => !t.error).length;
        ctx.progress.counters.pending = ctx.tasks.filter((t) => t.error).length;
        return ctx;
    }
}
