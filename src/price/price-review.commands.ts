import { setJobActivity } from '../job/job.execution';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
import { Inject, Injectable } from '@nestjs/common';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { IJobCommand, IJobContext } from '../interfaces/i.job.context';
import { ExtraPriceService } from './extra.price.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { calculatePrice } from '../helpers/price/price.helpers';
import { wbDiscountTo } from '../helpers/price/wb.discount.helper';
import { UpdatePriceDto } from './dto/update.price.dto';
import { jobCheckpoint } from '../job/job.checkpoint';

export interface PriceReviewEntry {
    service: GoodServiceEnum;
    prices: UpdatePriceDto[];
    discount?: number;
    warnings?: string[];
    error?: string;
    response?: unknown;
    status?: 'accepted' | 'unchanged' | 'completed' | 'skipped' | 'failed';
}
export interface PriceReviewContext extends IJobContext {
    offerId: string;
    entries: PriceReviewEntry[];
    assertCurrent?: (service: string) => void;
}
@Injectable()
export class PreparePriceReviewCommand implements IJobCommand<PriceReviewContext> {
    readonly phase = 'Подготовка цен по площадкам';
    readonly weight = 1;
    constructor(
        private readonly extra: ExtraPriceService,
        @Inject(GOOD_SERVICE) private readonly goods: IGood,
    ) {}
    async execute(ctx: PriceReviewContext) {
        const services = Object.values(GoodServiceEnum).filter((name) => this.extra.getService(name));
        ctx.progress.total = services.length;
        for (const name of services) {
            await jobCheckpoint(ctx);
            setJobActivity(name, 'Подготовка расчёта');
            const entry = await this.entry(name, ctx.offerId);
            setJobActivity(
                name,
                entry.error ? 'Расчёт недоступен' : 'Расчёт готов',
                entry.error ? 'failed' : 'done',
                entry.error,
            );
            ctx.entries.push(entry);
            ctx.progress.done++;
        }
        return ctx;
    }
    async entry(name: GoodServiceEnum, offerId: string): Promise<PriceReviewEntry> {
        const service = this.extra.getService(name);
        const entry: PriceReviewEntry = { service: name, prices: [] };
        try {
            const inputs = await this.goods.buildPriceables(service, [offerId]);
            const warnings = [...new Set(inputs.flatMap((input) => input.ozon?.warnings ?? []))];
            if (warnings.length) entry.warnings = warnings;
            entry.prices = inputs.map((input) => calculatePrice(input, service.getObtainCoeffs()));
            if (!entry.prices.length) entry.error = 'Товар не найден или нет базы для расчёта';
            if (
                entry.prices.some(
                    (p) =>
                        ![p.min_price, p.price, p.old_price].every((n) => Number.isFinite(Number(n)) && Number(n) > 0),
                )
            )
                throw new Error('Получены некорректные цены');
            if (name === GoodServiceEnum.WB && entry.prices.length)
                entry.discount = wbDiscountTo(Number(entry.prices[0].old_price), Number(entry.prices[0].min_price));
        } catch (error) {
            entry.prices = [];
            entry.error = error.message;
        }
        return entry;
    }
}
@Injectable()
export class SendPriceReviewCommand implements IJobCommand<PriceReviewContext> {
    readonly phase = 'Подготовка подтверждённых цен';
    readonly weight = 1;
    constructor(
        private readonly extra: ExtraPriceService,
        private readonly prepare: PreparePriceReviewCommand,
    ) {}
    async execute(ctx: PriceReviewContext) {
        ctx.progress.total = ctx.entries.length;
        const results = await Promise.allSettled(
            ctx.entries.map(async (entry) => {
                await jobCheckpoint(ctx);
                if (!entry.error && entry.prices.length) {
                    let attempted = false;
                    setJobActivity(entry.service, 'Проверка актуальности цен');
                    try {
                        entry.response = await priceUpdateQueue.run(
                            entry.service,
                            async () => {
                                ctx.assertCurrent?.(entry.service);
                                const service = this.extra.getService(entry.service);
                                if (!service) throw new Error('Площадка отключена. Подготовьте цены заново.');
                                const current = await this.prepare.entry(entry.service, ctx.offerId);
                                if (current.error || JSON.stringify(current.prices) !== JSON.stringify(entry.prices))
                                    throw new Error(
                                        'Данные расчёта изменились. Подготовьте цены заново.' +
                                            (current.error ? ` ${current.error}` : ''),
                                    );
                                await jobCheckpoint(ctx);
                                ctx.assertCurrent?.(entry.service);
                                setJobActivity(entry.service, 'Выполнение запроса площадки');
                                ctx.progress.phase = 'Обработка запросов площадок';
                                attempted = true;
                                try {
                                    return await service.updatePrices(entry.prices);
                                } finally {
                                    priceUpdateQueue.changed(
                                        entry.service,
                                        entry.prices.map((p) => p.offer_id),
                                    );
                                }
                            },
                            {
                                priority: 'manual',
                                onWaiting: (waiting) => {
                                    ctx.progress.counters[`waiting:${entry.service}`] = Number(waiting);
                                },
                            },
                        );
                        const r: any = entry.response;
                        if (
                            entry.service === GoodServiceEnum.OZON &&
                            (!r?.result?.length ||
                                entry.prices.some(
                                    (price) =>
                                        !r.result.some((item) => item.offer_id === price.offer_id && item.updated),
                                ))
                        )
                            entry.error = 'Ozon не подтвердил обновление всех цен. Смотрите ответ площадки.';
                        else if (
                            r == null ||
                            (Array.isArray(r) && r.some((row) => row?.error)) ||
                            r?.results?.some((row) => row.status === 'error') ||
                            r?.error ||
                            r?.errors?.length ||
                            r?.status === 'NotOk' ||
                            (r?.offerUpdate && r.offerUpdate.status !== 'OK')
                        )
                            entry.error = 'Площадка вернула ошибку. Смотрите ответ ниже.';
                        entry.status = entry.error
                            ? 'failed'
                            : r?.results?.length && r.results.every((row) => row.status === 'unchanged')
                              ? 'unchanged'
                              : entry.service === GoodServiceEnum.OZON ||
                                  r?.data?.id ||
                                  r?.status === 'OK' ||
                                  r?.results?.some((row) => row.status === 'accepted') ||
                                  r?.updated > 0
                                ? 'accepted'
                                : 'completed';
                    } catch (error) {
                        entry.error = error.message;
                        entry.status = attempted ? 'failed' : 'skipped';
                    }
                } else entry.status = 'skipped';
                setJobActivity(
                    entry.service,
                    entry.status === 'completed'
                        ? 'Запрос завершён; проверьте ответ'
                        : entry.status === 'accepted'
                          ? 'Запрос принят площадкой'
                          : entry.status === 'unchanged'
                            ? 'Цены уже совпадали'
                            : entry.status === 'skipped'
                              ? 'Не отправлено'
                              : 'Запрос не подтверждён',
                    entry.status === 'failed' ? 'failed' : entry.status === 'skipped' ? 'skipped' : 'done',
                    entry.error,
                );
                ctx.progress.done++;
            }),
        );
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
        return ctx;
    }
}
