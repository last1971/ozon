import { pricingStocks } from '../../../helpers/price/pricing-stock';
import { measureJobOperation } from '../../../job/job.execution';
import { jobCheckpoint } from '../../../job/job.checkpoint';
import { lossPriceFields } from '../../../helpers/price/marketplace.loss.input';
import { OzonCalculationCacheService } from '../../../price/ozon-calculation-cache.service';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chunk } from 'lodash';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { OzonPricingService } from '../../../price/ozon.pricing.service';
import { ProductService } from '../../../product/product.service';
import { ProductVisibility } from '../../../product/product.visibility';
import { Trade2006GoodService } from '../../../trade2006.good/trade2006.good.service';
import { goodCode, goodQuantityCoeff } from '../../../helpers';
import { resolvePriceBase } from '../../../helpers/price/price.base';
import { completePricePercents } from '../../../helpers/price/price.percents';
import { ozonPricingInput } from '../../../helpers/price/ozon.pricing.input';
import { calculateOzonPrices, ozonDeadZoneFloor } from '../../../helpers/price/ozon.pricing';
import { IPromoSweepContext } from './promo-sweep.context';
import { sweepGoal } from './sweep-goal';

@Injectable()
export class EnrichWithPricingCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Расчёт минимальных цен';
    readonly weight = 10;
    constructor(
        private readonly pricing: OzonPricingService,
        private readonly products: ProductService,
        private readonly goods: Trade2006GoodService,
        private readonly config: ConfigService,
        @Optional() private readonly calculations?: OzonCalculationCacheService,
    ) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const states = context.collectedStates ?? context.states ?? [];
        context.pricingErrors = new Map();
        context.progress.counters.noBase ??= 0;
        context.progress.counters.noStock ??= 0;
        context.progress.total = states.length;
        context.progress.done = 0;
        for (const state of states) {
            delete state.calcMinPrice;
            delete state.deadZoneFloor;
        }
        const coeffs = {
            sumLabel: Number(this.config.get('SUM_LABEL', 13)),
            sumObtain: Number(this.config.get('SUM_OBTAIN', 25)),
            taxUnit: Number(this.config.get('TAX_UNIT', 6)),
            minMil: 0,
            percMil: 0,
            percEkv: 0, // Для Ozon эти расходы поступают из API в pricing.load.
        };
        for (const batch of chunk(states, 100)) {
            if (context.stopChain) break;
            const offers = batch.map((s) => s.offerId);
            let data: Awaited<ReturnType<typeof this.loadBatch>>;
            let batchError: unknown;
            try {
                data = await measureJobOperation('inputReadMs', () => this.loadBatch(offers));
            } catch (e) {
                batchError = e;
            }
            for (const [index, state] of batch.entries()) {
                if (context.stopChain) break;
                if (index % 25 === 0) await jobCheckpoint(context);
                try {
                    if (batchError) throw batchError;
                    const stock = data.stocks.get(state.offerId);
                    if (stock?.state === 'empty') {
                        context.progress.counters.noStock++;
                        context.progress.done++;
                        continue;
                    }
                    if (stock?.state !== 'available') throw new Error(stock?.state === 'unknown' ? stock.message : 'Не удалось проверить наличие товара');
                    const product = data.products.find((p) => p.offer_id === state.offerId);
                    const info = data.infos.find((p) => p.sku === state.offerId);
                    if (!product || !info) throw new Error('нет карточки Ozon');
                    const code = goodCode({ offer_id: state.offerId });
                    const pieces = goodQuantityCoeff({ offer_id: state.offerId });
                    await completePricePercents([state.offerId], this.goods, data);
                    const percent = data.percents.find(
                        (p) => String(p.offer_id) === code && Number(p.pieces ?? 1) === pieces,
                    );
                    const base = resolvePriceBase(
                        state.offerId,
                        pieces,
                        data.goods.find((g) => String(g.code) === code),
                        percent,
                        undefined,
                        info.fboCount,
                    );
                    if (base.base_source === 'none') throw new Error(`нет базы: ${base.skipReason}`);
                    if (!percent) throw new Error('нет наценок');
                    const ozon = await measureJobOperation('prepareMs', () => this.pricing.load(product, info));
                    const input = ozonPricingInput(
                        {
                            ...base,
                            ...lossPriceFields(
                                ozon.lossStatistics,
                                data.goods.find((g) => String(g.code) === code),
                                pieces,
                                info.fboCount,
                            ),
                            ozon,
                            offer_id: state.offerId,
                            min_perc: percent.min_perc,
                            perc: percent.perc,
                            old_perc: percent.old_perc,
                            adv_perc: percent.adv_perc ?? 0,
                            sum_pack: percent.packing_price ?? Number(this.config.get('SUM_PACK', 10)),
                            return_perc: percent.return_perc ?? 0,
                            sales_percent: 0,
                            fbs_direct_flow_trans_max_amount: 0, // Общие поля не используются формулой Ozon.
                        },
                        coeffs,
                    );
                    const cached = this.calculations
                        ? await this.calculations.calculate(state.offerId, input, {
                              product,
                              info,
                              goods: data.goods.find((g) => String(g.code) === code),
                              percent,
                              pieces,
                          })
                        : undefined;
                    const result = cached ? undefined : calculateOzonPrices(input);
                    state.calcMinPrice = cached ? cached.minPrice : result.min.salePrice;
                    const floor = cached ? cached.deadZoneFloor : ozonDeadZoneFloor(input, result);
                    const counter = cached?.cacheHit ? 'calculationCacheHit' : 'calculationCacheMiss';
                    context.progress.counters[counter] = (context.progress.counters[counter] ?? 0) + 1;
                    if (floor !== undefined) state.deadZoneFloor = floor;
                } catch (e) {
                    context.progress.counters.noBase++;
                    context.pricingErrors.set(state.offerId, e instanceof Error ? e.message : String(e));
                }
                context.progress.done++;
            }
        }
        // Повторный отбор нужен и для товара, чья цена совпала со старым min_price API.
        const goal = sweepGoal(context.goal);
        context.states = states.filter(
            (s) =>
                context.pricingErrors.has(s.offerId) ||
                (s.calcMinPrice !== undefined && goal.selects({ ...s, minPrice: s.calcMinPrice })),
        );
        context.progress.counters.selected = context.states.length;
        return context;
    }

    private async loadBatch(offers: string[]) {
        const infos = await this.products.infoList(offers);
        if (!Array.isArray(infos) || new Set(infos.map(info => info.sku)).size !== infos.length ||
            infos.some(info => !offers.includes(info.sku))) throw new Error('неполный ответ API Ozon');
        const stocks = await pricingStocks(offers, this.goods, async () => new Map(infos.map(info => [info.sku, info.fboCount])));
        const active = offers.filter(offer => stocks.get(offer)?.state === 'available');
        const codes = [...new Set(active.map(offer_id => goodCode({ offer_id })))];
        const [prices, goods, percents] = active.length ? await Promise.all([
            this.products.getPrices({ offer_id: active, visibility: ProductVisibility.ALL, limit: active.length }),
            this.goods.prices(codes, null),
            this.goods.getPerc(codes, null),
        ]) : [{ items: [] }, [], []];
        if (!Array.isArray(prices?.items)) throw new Error('неполный ответ API Ozon');
        if (active.length) await this.pricing.prepare(infos.filter(info => active.includes(info.sku)));
        return { products: prices.items, infos, goods, percents, stocks };
    }
}
