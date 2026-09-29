import { Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { ProductService } from '../product/product.service';
import { ICardSyncable, SyncCheckResult, SyncUpdateResult } from '../interfaces/i.card.sync';
import { BarcodeOffer, GtinBaseItem, GtinCheckItem } from '../interfaces/i.gtin.sync';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';
import { groupByGoodCode } from '../helpers/product/product.helpers';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { checkGtinOffers } from './gtin.decision';

/**
 * Озон как реализация режима GTIN. Читает: каталог (артикулы) → info/list по карточкам товаров базы
 * (баркоды + SKU). Решение — общее (checkGtinOffers). Пишет: /v1/barcode/add по SKU — штрихкоды только
 * добавляются, существующие Озон не трогает; снять штрихкод через API нельзя.
 */
@Injectable()
export class OzonGtinService implements ICardSyncable<GtinBaseItem, GtinCheckItem> {
    constructor(private readonly productService: ProductService) {}

    async check(
        base: GtinBaseItem[],
        progress: JobProgress = emptyProgress(),
    ): Promise<SyncCheckResult<GtinCheckItem>> {
        Object.assign(progress, { phase: 'каталог', done: 0, total: undefined });
        const catalog = groupByGoodCode(
            await this.productService.listAllOfferIds((loaded) => (progress.done = loaded)),
            (offer) => offer,
        );

        const offers = base.flatMap((b) => catalog.get(b.goodscode) ?? []);
        Object.assign(progress, { phase: 'баркоды', done: 0, total: offers.length });
        const infos = new Map<string, ProductInfoDto>();
        const failed = new Map<string, string>();
        for (const part of chunk(offers, 1000)) {
            try {
                for (const info of await this.productService.infoList(part)) if (info?.sku) infos.set(info.sku, info);
            } catch (e) {
                // info/list отказал на пачке — эти карточки «спорные», остальные сверяем
                for (const offer of part) failed.set(offer, `Озон не отдал карточку (info/list): ${e?.message ?? e}`);
            }
            progress.done += part.length;
        }

        const byGood = new Map<string, BarcodeOffer[]>();
        for (const b of base) {
            const list = (catalog.get(b.goodscode) ?? []).map((offer) =>
                this.toBarcodeOffer(offer, infos.get(offer), failed.get(offer)),
            );
            if (list.length) byGood.set(b.goodscode, list);
        }
        return checkGtinOffers(base, byGood, progress);
    }

    async update(items: GtinCheckItem[], progress: JobProgress = emptyProgress()): Promise<SyncUpdateResult[]> {
        Object.assign(progress, { phase: 'запись', done: 0, total: items.length });
        const results = new Map<string, SyncUpdateResult>();
        // не больше 100 штрихкодов в запросе (лимит ручки — по штрихкодам, не по карточкам);
        // карточку между запросами не делим; не чаще 20 запросов в минуту — @RateLimit на addBarcodes
        for (const part of this.packByBarcodes(items, 100)) {
            const entries = part.flatMap((i) => i.add.map((barcode) => ({ barcode, sku: i.marketId })));
            let res: any;
            try {
                res = await this.productService.addBarcodes(entries);
            } catch (e) {
                res = { error: { message: e?.message ?? String(e) } };
            }
            if (!res || res.error) {
                // сбой запроса целиком: OzonApiService.method не бросает, а отдаёт { result: null, error }
                const msg = res?.error?.message ?? res?.error?.service_message ?? JSON.stringify(res?.error ?? res);
                for (const i of part) results.set(i.offer, { offer: i.offer, error: `Озон отказал: ${msg}` });
                progress.done += part.length;
                continue;
            }
            // успех — построчные отказы в errors[]: { code, error, barcode, sku }
            const rejected = new Map<number, string[]>();
            for (const e of res.errors ?? []) {
                const list = rejected.get(Number(e.sku)) ?? [];
                list.push(`${e.barcode}: ${e.error || e.code}`);
                rejected.set(Number(e.sku), list);
            }
            for (const i of part) {
                const errs = rejected.get(Number(i.marketId));
                results.set(
                    i.offer,
                    errs ? { offer: i.offer, error: `Озон отказал: ${errs.join('; ')}` } : { offer: i.offer },
                );
                // в суточном кэше атрибутов карточки лежат и баркоды (их копирует создание карточки ВБ из Озона)
                if (!errs) await this.productService.evictProductAttributes(i.offer);
            }
            progress.done += part.length;
        }
        return items.map((i) => results.get(i.offer));
    }

    /** Пачки целых карточек, в каждой не больше limit штрихкодов. */
    private packByBarcodes(items: GtinCheckItem[], limit: number): GtinCheckItem[][] {
        const parts: GtinCheckItem[][] = [];
        let part: GtinCheckItem[] = [];
        let count = 0;
        for (const item of items) {
            if (part.length && count + item.add.length > limit) {
                parts.push(part);
                part = [];
                count = 0;
            }
            part.push(item);
            count += item.add.length;
        }
        if (part.length) parts.push(part);
        return parts;
    }

    /** Карточка Озона глазами режима GTIN. Без SKU писать некуда: /v1/barcode/add адресует карточку только по нему. */
    private toBarcodeOffer(offer: string, info: ProductInfoDto | undefined, error: string | undefined): BarcodeOffer {
        if (error) return { offer, barcodes: [], ambiguousReason: error };
        if (!info) return { offer, barcodes: [], ambiguousReason: 'Озон не отдал карточку (info/list)' };
        return {
            offer,
            name: info.remark,
            barcodes: info.barcodes ?? [],
            marketId: info.marketSku,
            ...(info.marketSku
                ? {}
                : { ambiguousReason: 'у карточки нет SKU Озона (не прошла модерацию?) — привязать штрихкод некуда' }),
        };
    }
}
