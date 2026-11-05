import { Injectable } from '@nestjs/common';
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
    readonly phase = 'расчёт цен';
    constructor(
        private readonly pricing: OzonPricingService,
        private readonly products: ProductService,
        private readonly goods: Trade2006GoodService,
        private readonly config: ConfigService,
    ) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const states = context.collectedStates ?? context.states ?? [];
        context.pricingErrors = new Map();
        context.progress.counters.noBase ??= 0;
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
            const codes = [...new Set<string>(offers.map((offer_id) => String(goodCode({ offer_id }))))];
            let data: Awaited<ReturnType<typeof this.loadBatch>>;
            let batchError: unknown;
            try {
                data = await this.loadBatch(offers, codes);
            } catch (e) {
                batchError = e;
            }
            for (const state of batch) {
                if (context.stopChain) break;
                try {
                    if (batchError) throw batchError;
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
                    );
                    if (base.base_source === 'none') throw new Error(`нет базы: ${base.skipReason}`);
                    if (!percent) throw new Error('нет наценок');
                    const ozon = await this.pricing.load(product, info);
                    const input = ozonPricingInput(
                        {
                            ...base,
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
                    const result = calculateOzonPrices(input);
                    state.calcMinPrice = result.min.salePrice;
                    const floor = ozonDeadZoneFloor(input, result);
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

    private async loadBatch(offers: string[], codes: string[]) {
        const [prices, infos, goods, percents] = await Promise.all([
            this.products.getPrices({ offer_id: offers, visibility: ProductVisibility.ALL, limit: offers.length }),
            this.products.infoList(offers),
            this.goods.prices(codes, null),
            this.goods.getPerc(codes, null),
        ]);
        if (!Array.isArray(prices?.items) || !Array.isArray(infos)) throw new Error('неполный ответ API Ozon');
        return { products: prices.items, infos, goods, percents };
    }
}
