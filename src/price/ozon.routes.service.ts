import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { createHash } from 'crypto';
import { chunk } from 'lodash';
import { PostingService } from '../posting/posting.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { ProductService } from '../product/product.service';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { buildOzonRoutes, OzonRoutesSnapshot } from '../helpers/price/ozon.routes';

@Injectable()
export class OzonRoutesService {
    readonly cacheKey: string;
    private refreshing: Promise<OzonRoutesSnapshot> | null = null;
    private refreshingTo: string | null = null;
    private readonly logger = new Logger(OzonRoutesService.name);
    constructor(
        private readonly config: ConfigService,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        private readonly fbs: PostingService,
        private readonly fbo: PostingFboService,
        private readonly products: ProductService,
    ) {
        const instance = createHash('sha256')
            .update(`${config.get('FB_HOST', '')}|${config.get('FB_BASE', '')}`)
            .digest('hex')
            .slice(0, 16);
        this.cacheKey = `ozon:routes:v1:${instance}`;
    }

    private window(now: Date) {
        const to = DateTime.fromJSDate(now, { zone: 'Europe/Moscow' }).startOf('day');
        if (!to.isValid) throw new Error('Некорректная дата распределения');
        return { from: to.minus({ days: 90 }).toISO(), to: to.toISO() };
    }

    async get(now = new Date()): Promise<OzonRoutesSnapshot> {
        const { from, to } = this.window(now);
        const cached = await this.cache.get<OzonRoutesSnapshot>(this.cacheKey);
        if (
            cached?.version === 1 &&
            cached.from === from &&
            cached.to === to &&
            Array.isArray(cached.buckets) &&
            cached.buckets.every(
                (b) =>
                    b &&
                    ['fbs', 'fbo'].includes(b.scheme) &&
                    ['offer', 'type', 'cabinet'].includes(b.scope) &&
                    typeof b.key === 'string' &&
                    Number.isSafeInteger(b.units) &&
                    b.units > 0 &&
                    Array.isArray(b.destinations) &&
                    b.destinations.every(
                        (d) => d && typeof d.cluster === 'string' && Number.isSafeInteger(d.units) && d.units > 0,
                    ) &&
                    b.destinations.reduce((sum, d) => sum + d.units, 0) === b.units,
            )
        )
            return cached;
        return this.refresh(now);
    }

    refresh(now = new Date()): Promise<OzonRoutesSnapshot> {
        const { to } = this.window(now);
        if (this.refreshing) {
            if (this.refreshingTo === to) return this.refreshing;
            return this.refreshing.catch(() => undefined).then(() => this.refresh(now));
        }
        this.refreshingTo = to;
        this.refreshing = this.rebuild(now).finally(() => {
            this.refreshing = null;
            this.refreshingTo = null;
        });
        return this.refreshing;
    }

    private async rebuild(now: Date): Promise<OzonRoutesSnapshot> {
        const { from, to } = this.window(now);
        const offers = [...new Set(await this.products.listAllOfferIds())];
        if (!offers.length) throw new Error('Пустой каталог; прежнее распределение не заменено');
        const catalog: ProductInfoDto[] = [];
        for (const batch of chunk(offers, 100)) catalog.push(...(await this.products.infoList(batch)));
        const found = new Set(catalog.map((p) => p.sku));
        if (found.size !== catalog.length || found.size !== offers.length || offers.some((o) => !found.has(o)))
            throw new Error('Неполный каталог для категорий логистики');
        // Чтение через существующие загрузчики; не вызываем обработку заказов и запись журнала.
        const fbs = await this.fbs.listForLogistics(new Date(from), new Date(to));
        const fbo = await this.fbo.listForLogistics(new Date(from), new Date(to));
        const snapshot = buildOzonRoutes(
            [
                { scheme: 'fbs', postings: fbs },
                { scheme: 'fbo', postings: fbo },
            ],
            catalog,
            from,
            to,
        );
        await this.cache.set(this.cacheKey, snapshot, 2 * 86400_000);
        return snapshot;
    }

    @Cron('0 48 5 * * *', { name: 'ozonLogisticsRoutes', timeZone: 'Europe/Moscow' })
    async daily(): Promise<void> {
        const services = this.config.get<string[] | string>('SERVICES', []);
        if (
            this.config.get('NODE_ENV') !== 'production' ||
            !(Array.isArray(services) ? services : services.split(',')).includes('ozon')
        )
            return;
        try {
            await this.refresh();
        } catch (e) {
            this.logger.error(`Не обновлено распределение доставок Ozon: ${e.message}`);
        }
    }
}
