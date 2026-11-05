import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { chunk } from 'lodash';
import { ProductService } from '../product/product.service';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { OzonReturnPreviewService } from './ozon.return.preview.service';
import { OzonReturnStore } from './ozon.return.store';
import { buildOzonReturnSnapshot } from '../helpers/price/ozon.return.snapshot';
import { ozonSkuOf } from '../helpers/price/ozon.accrual.normalizer';

/** Организация суточного пересчёта: существующий каталог → готовый расчёт → атомарное сохранение. */
@Injectable()
export class OzonReturnService {
    private readonly logger = new Logger(OzonReturnService.name);
    private running = false;

    constructor(
        private readonly config: ConfigService,
        private readonly products: ProductService,
        private readonly previewService: OzonReturnPreviewService,
        private readonly store: OzonReturnStore,
    ) {}

    @Cron('0 38 5 * * *', { name: 'ozonReturnPerc', timeZone: 'Europe/Moscow' })
    async daily(): Promise<void> {
        const services = this.config.get<string[] | string>('SERVICES', []);
        if (
            this.config.get('NODE_ENV') !== 'production' ||
            !(Array.isArray(services) ? services : services.split(',')).includes('ozon')
        )
            return;
        try {
            const result = await this.recalculate();
            this.logger.log(
                `Возвраты Ozon: сохранено ${result.rows} фасовок за ${result.from} — ${result.to} (не включая)`,
            );
        } catch (error) {
            this.logger.error(`Не удалось обновить процент возвратов Ozon: ${error.message}`);
        }
    }

    async recalculate(now = new Date()): Promise<{ rows: number; from: string; to: string }> {
        if (this.running) throw new Error('Пересчёт возвратов Ozon уже выполняется');
        this.running = true;
        try {
            const end = DateTime.fromJSDate(now, { zone: 'Europe/Moscow' }).startOf('day');
            if (!end.isValid) throw new Error('Некорректная дата пересчёта');
            const from = end.minus({ days: 90 }).toISODate();
            const to = end.toISODate();
            const minSales = Number(this.config.get('OZON_RETURN_MIN_SALES', 1));
            const defaultPerc = Number(this.config.get('OZON_RETURN_PERC_DEFAULT', 0));
            // Проверка настроек до сетевых запросов и до любой записи.
            buildOzonReturnSnapshot({ rows: [], issues: [] }, [], minSales, defaultPerc);
            const offers = [...new Set(await this.products.listAllOfferIds())];
            if (!offers.length) throw new Error('Пустой каталог Ozon; прежняя статистика сохранена');
            const catalog: ProductInfoDto[] = [];
            for (const batch of chunk(offers, 100)) catalog.push(...(await this.products.infoList(batch)));
            const found = new Set(catalog.map((p) => p.sku));
            if (
                found.size !== catalog.length ||
                found.size !== offers.length ||
                offers.some((offer) => !found.has(offer))
            ) {
                throw new Error('Неполный или неоднозначный каталог Ozon; прежняя статистика сохранена');
            }
            const skuToOffer = new Map<string, string>();
            for (const product of catalog) {
                for (const value of [product.marketSku, product.cabinetSku]) {
                    if (value == null) continue;
                    const sku = ozonSkuOf(value);
                    if (skuToOffer.has(sku) && skuToOffer.get(sku) !== product.sku)
                        throw new Error(`Неоднозначный SKU Ozon: ${sku}`);
                    skuToOffer.set(sku, product.sku);
                }
            }
            const report = await this.previewService.preview(from, to, skuToOffer);
            const values = buildOzonReturnSnapshot(report, catalog, minSales, defaultPerc);
            await this.store.save(values, now, defaultPerc);
            return { rows: values.length, from, to };
        } finally {
            this.running = false;
        }
    }
}
