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
    error?: string;
    response?: unknown;
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
            const service = this.extra.getService(name);
            const entry: PriceReviewEntry = { service: name, prices: [] };
            try {
                const inputs = await this.goods.buildPriceables(service, [ctx.offerId]);
                entry.prices = inputs.map((input) => calculatePrice(input, service.getObtainCoeffs()));
                if (!entry.prices.length) entry.error = 'Товар не найден или нет базы для расчёта';
                if (
                    entry.prices.some(
                        (p) =>
                            ![p.min_price, p.price, p.old_price].every(
                                (n) => Number.isFinite(Number(n)) && Number(n) > 0,
                            ),
                    )
                )
                    throw new Error('Получены некорректные цены');
                if (name === GoodServiceEnum.WB && entry.prices.length)
                    entry.discount = wbDiscountTo(Number(entry.prices[0].old_price), Number(entry.prices[0].min_price));
            } catch (error) {
                entry.prices = [];
                entry.error = error.message;
            }
            ctx.entries.push(entry);
            ctx.progress.done++;
        }
        return ctx;
    }
}
@Injectable()
export class SendPriceReviewCommand implements IJobCommand<PriceReviewContext> {
    readonly phase = 'Отправка подтверждённых цен';
    readonly weight = 1;
    constructor(private readonly extra: ExtraPriceService) {}
    async execute(ctx: PriceReviewContext) {
        ctx.progress.total = ctx.entries.length;
        for (const entry of ctx.entries) {
            await jobCheckpoint(ctx);
            if (!entry.error && entry.prices.length) {
                try {
                    entry.response = await priceUpdateQueue.run(entry.service, async () => {
                        ctx.assertCurrent?.(entry.service);
                        return this.extra.getService(entry.service).updatePrices(entry.prices);
                    });
                    const r: any = entry.response;
                    if (
                        entry.service === GoodServiceEnum.OZON &&
                        (!r?.result?.length || r.result.some((item) => !item.updated))
                    )
                        entry.error = 'Ozon не подтвердил обновление всех цен. Смотрите ответ площадки.';
                    else if (
                        r?.error ||
                        r?.errors?.length ||
                        r?.status === 'NotOk' ||
                        (r?.offerUpdate && r.offerUpdate.status !== 'OK')
                    )
                        entry.error = 'Площадка вернула ошибку. Смотрите ответ ниже.';
                } catch (error) {
                    entry.error = error.message;
                }
            }
            ctx.progress.done++;
        }
        return ctx;
    }
}
