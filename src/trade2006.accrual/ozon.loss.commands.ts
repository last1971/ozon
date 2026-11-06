import { Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { IJobCommand } from '../interfaces/i.job.context';
import { SaveLossContext } from '../marketplace-loss/loss.commands';
import { ProductService } from '../product/product.service';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { buildOzonReturnSnapshot } from '../helpers/price/ozon.return.snapshot';
import { calculateLossRates, lossOfferKey } from '../helpers/price/marketplace.loss.stats';
import { ozonSkuOf } from '../helpers/price/ozon.accrual.normalizer';
import { OzonReturnStore } from './ozon.return.store';
import { jobCheckpoint } from '../job/job.checkpoint';

export interface OzonLossContext extends SaveLossContext {
    catalog: ProductInfoDto[];
    skuToOffer: Map<string, string>;
    knownOffers: string[];
    minSales: number;
    defaultPerc: number;
}

@Injectable()
export class LoadOzonLossCatalogCommand implements IJobCommand<OzonLossContext> {
    readonly phase = 'Каталог Ozon';
    readonly weight = 20;
    constructor(
        private readonly products: ProductService,
        private readonly store: OzonReturnStore,
    ) {}
    async execute(ctx: OzonLossContext) {
        // Та же проверка настроек, до сети и записи.
        buildOzonReturnSnapshot({ rows: [], issues: [] }, [], ctx.minSales, ctx.defaultPerc);
        await jobCheckpoint(ctx);
        const offers = [...new Set(await this.products.listAllOfferIds())];
        if (!offers.length) throw new Error('Пустой каталог Ozon; прежняя статистика сохранена');
        ctx.progress.total = offers.length;
        for (const batch of chunk(offers, 100)) {
            ctx.catalog.push(...(await this.products.infoList(batch)));
            ctx.progress.done += batch.length;
            await jobCheckpoint(ctx);
        }
        const found = new Set(ctx.catalog.map((p) => p.sku));
        if (
            found.size !== ctx.catalog.length ||
            found.size !== offers.length ||
            offers.some((offer) => !found.has(offer))
        )
            throw new Error('Неполный или неоднозначный каталог Ozon; прежняя статистика сохранена');
        for (const product of ctx.catalog) {
            for (const value of [product.marketSku, product.cabinetSku]) {
                if (value == null) continue;
                const sku = ozonSkuOf(value);
                if (ctx.skuToOffer.has(sku) && ctx.skuToOffer.get(sku) !== product.sku)
                    throw new Error(`Неоднозначный SKU Ozon: ${sku}`);
                ctx.skuToOffer.set(sku, product.sku);
            }
        }
        // В прежней записи устаревшие строки OZON_PERC тоже сбрасывались в резервный процент.
        ctx.knownOffers = await this.store.listKnownOffers();
        await jobCheckpoint(ctx);
        return ctx;
    }
}

@Injectable()
export class ApplyOzonReturnPolicyCommand implements IJobCommand<OzonLossContext> {
    readonly phase = 'Процент для цены Ozon';
    readonly weight = 10;
    async execute(ctx: OzonLossContext) {
        const report = {
            issues: [],
            rows: ctx.rows.map((row) => ({
                offerId: row.offerId,
                soldUnits: row.soldUnits,
                paidReturnUnits: row.returnedUnits,
                returnPerc: row.returnRate ?? 0,
            })),
        };
        // Единственная существующая политика: свой процент → тип → резерв.
        const values = buildOzonReturnSnapshot(report, ctx.catalog, ctx.minSales, ctx.defaultPerc);
        const rows = new Map(ctx.rows.map((row) => [row.offerId, row]));
        const applied = new Map(values.map((row) => [lossOfferKey(`${row.goodscode}-${row.pieces}`), row.returnPerc]));
        const offers = new Set([...rows.keys(), ...applied.keys(), ...ctx.knownOffers]);
        ctx.progress.total = offers.size;
        for (const offer of offers) {
            if (!rows.has(offer)) {
                const counts = { soldUnits: 0, returnedUnits: 0, writtenOffUnits: 0 };
                rows.set(offer, { offerId: offer, ...counts, ...calculateLossRates(counts) });
            }
            // Прежнее хранилище NUMERIC(9,6): округление сохраняем только для применяемой доли.
            rows.get(offer).appliedReturnRate = Number((applied.get(offer) ?? ctx.defaultPerc).toFixed(6));
            if (++ctx.progress.done % 100 === 0) await jobCheckpoint(ctx);
        }
        ctx.rows = [...rows.values()];
        await jobCheckpoint(ctx);
        return ctx;
    }
}
