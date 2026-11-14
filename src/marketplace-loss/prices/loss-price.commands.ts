import { groupLossPriceOffers } from './loss-price.offers';
import { setJobActivity } from '../../job/job.execution';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
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

const valid = (ctx: LossPriceContext) => ctx.tasks.filter((t) => !t.error && !t.deferred && !t.waitingForStock);
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
            if (!task.error && task.events.every(event => (event.payload as LossPricePayload)?.waitingForStock === true)) {
                task.waitingForStock = true;
                task.deferred = true;
                continue;
            }
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
        const snapshot = priceUpdateQueue.reader(
            ctx.service.toLowerCase(),
            valid(ctx).map((t) => t.offerId),
        );
        const offers = groupLossPriceOffers(ctx.availableOffers ?? ctx.catalog ?? ctx.offerIds ?? await ctx.adapter.offers());
        const requested = new Map<string, LossPriceTask>();
        for (const task of valid(ctx)) {
            const actual = offers.get(task.offerId);
            if (!actual?.length) {
                task.error = 'Товар этой фасовки не найден в кабинете';
                task.failureKind = 'data';
                continue;
            }
            task.snapshot = snapshot(actual);
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
                        if (failure?.reason === 'no-free-stock') {
                            task.waitingForStock = true;
                            continue;
                        }
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
        for (const task of ctx.tasks) if (task.error || task.waitingForStock) task.targets = [];
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
        ctx.current = current;
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
    readonly phase = 'Подготовка запросов цен';
    readonly weight = 2;
    async execute(ctx: LossPriceContext) {
        ctx.progress.total = valid(ctx).reduce((count, task) => count + task.changed.length, 0);
        const key = ctx.service.toLowerCase();
        for (const task of valid(ctx)) {
            await jobCheckpoint(ctx);
            try {
                await priceUpdateQueue.run(
                    key,
                    async () => {
                        await jobCheckpoint(ctx);
                        await ctx.assertInputsCurrent?.(task.offerId);
                        if (task.snapshot) priceUpdateQueue.assertCurrent(task.snapshot);
                        try {
                            const unchanged = task.targets.filter((p) => !task.changed.includes(p));
                            if (unchanged.length) {
                                setJobActivity(key, 'Сохранение ограничения цены');
                                await ctx.adapter.persist(unchanged);
                            }
                            if (task.changed.length) {
                                setJobActivity(key, 'Подготовка запроса площадки');
                                ctx.sent += task.changed.length;
                                const response = await ctx.adapter.send(task.changed, ctx.current);
                                const single = { ...ctx, tasks: [task] };
                                rejectOffers(
                                    single,
                                    new Map([
                                        ...task.targets
                                            .filter((p) => !task.changed.includes(p))
                                            .map((p) => [p.offer_id, null] as [string, null]),
                                        ...response,
                                    ]),
                                );
                            }
                        } finally {
                            priceUpdateQueue.changed(
                                key,
                                task.targets.map((t) => t.offer_id),
                            );
                            task.snapshot = priceUpdateQueue.capture(
                                key,
                                task.targets.map((t) => t.offer_id),
                            );
                        }
                    },
                    {
                        priority: 'background',
                        onWaiting: (waiting) => {
                            ctx.progress.counters.waiting = Number(waiting);
                        },
                    },
                );
            } catch (error) {
                task.error = reason(error);
                task.failureKind = pricingFailureKind(error);
            }
            ctx.progress.done += task.changed.length;
        }
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
                    await ctx.assertInputsCurrent?.(task.offerId);
                    if (task.snapshot) priceUpdateQueue.assertCurrent(task.snapshot);
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
        for (const task of valid(ctx)) {
            try {
                await ctx.assertInputsCurrent?.(task.offerId);
            } catch (error) {
                task.error = reason(error);
                task.failureKind = 'temporary';
            }
        }
        const all = targets(ctx);
        const results = new Map<string, LossPriceResult>();
        ctx.progress.total = all.length;
        for (const batch of chunk(all, ctx.adapter.promoBatchSize ?? 100)) {
            await jobCheckpoint(ctx);
            try {
                const offers = batch.map((p) => p.offer_id);
                const snapshots = new Map(
                    valid(ctx).flatMap((task) => task.targets.map((p) => [p.offer_id, task.snapshot] as const)),
                );
                const response = ctx.assertInputsCurrent
                    ? await ctx.adapter.promos(offers, snapshots, ctx.assertInputsCurrent)
                    : await ctx.adapter.promos(offers, snapshots);
                for (const [offer, error] of response) results.set(offer, error);
                const accepted = batch.filter((p) => response.has(p.offer_id) && response.get(p.offer_id) === null);
                if (accepted.length && ctx.adapter.verifyPromos) {
                    setJobActivity(ctx.service.toLowerCase(), 'Подтверждение итоговой цены с акциями');
                    try {
                        const verified = await ctx.adapter.verifyPromos(accepted);
                        for (const p of accepted)
                            results.set(p.offer_id, verified.has(p.offer_id)
                                ? verified.get(p.offer_id)
                                : { message: 'Нет подтверждения итоговой цены', kind: 'temporary' });
                    } catch (e) {
                        // Ошибка чтения не подменяет уже полученный отказ акции у других товаров.
                        accepted.forEach((p) => results.set(p.offer_id, { message: reason(e), kind: pricingFailureKind(e) }));
                    }
                }
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
                if (task.waitingForStock) await this.queue.waitForStock(ctx.service, event);
                else if (!task.deferred) await this.queue.finish(ctx.service, event, task.error, task.failureKind);
            }
            ctx.progress.done++;
        }
        ctx.progress.counters.completed = ctx.tasks.filter((t) => !t.error && !t.deferred && !t.waitingForStock).length;
        ctx.progress.counters.pending = ctx.tasks.filter((t) => t.error || t.waitingForStock).length;
        ctx.progress.counters.waitingStock = ctx.tasks.filter((t) => t.waitingForStock).length;
        return ctx;
    }
}
