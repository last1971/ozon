import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductService } from '../product/product.service';
import {
    ITnvedUpdateable,
    TnvedBaseItem,
    TnvedCheckItem,
    TnvedCheckResult,
    TnvedMarketOffer,
    TnvedUpdateResult,
} from '../interfaces/i.tnved.updateable';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';

/** Метка маркируемого варианта в словаре ТН ВЭД Озона; ею же пользуется справочник (OzonDictService). */
export const MARK_LABEL = 'МАРКИРОВКА РФ';

interface TnvedVariant {
    id: number;
    value: string;
}

/** Решение по карточке Озона: сверх общего — целевой вариант словаря для записи. */
interface OzonTnvedItem extends TnvedCheckItem {
    dictValueId?: number;
}

/**
 * Озон как реализация договора ТН ВЭД. Ветвится по MARK_REQUIRED:
 *   - маркируемый (MR=1)   → вариант ТНВЭД «МАРКИРОВКА РФ» (если есть) + чекбокс «Нужен код маркировки» ON;
 *   - немаркируемый (MR=0) → плоский вариант ТНВЭД (без «МАРКИРОВКА РФ») + чекбокс OFF.
 * Всё озоновское — id атрибутов, словари, галочка — внутри; наружу только TnvedCheckItem.
 */
@Injectable()
export class OzonTnvedService implements ITnvedUpdateable {
    private readonly tnvedAttrId: number;
    private readonly markAttrId: number;

    constructor(
        private readonly productService: ProductService,
        config: ConfigService,
    ) {
        // ТН ВЭД коды ЕАЭС / «Нужен код маркировки» — id атрибутов Ozon (глобальные, вынесены в конфиг)
        this.tnvedAttrId = config.get<number>('OZON_TNVED_ATTR_ID', 22232);
        this.markAttrId = config.get<number>('OZON_MARK_REQUIRED_ATTR_ID', 23536);
    }

    async checkTnved(base: TnvedBaseItem[], progress: JobProgress = emptyProgress()): Promise<TnvedCheckResult> {
        Object.assign(progress, { phase: 'каталог', done: 0, total: undefined });
        const offerMap = await this.loadOfferMap((loaded) => (progress.done = loaded));
        Object.assign(progress, { phase: 'сверка', done: 0, total: base.length });
        // варианты ТНВЭД в категории, ключ (cat:type:tnved) — резолвим один раз
        const dictCache = new Map<string, TnvedVariant[]>();
        const result: TnvedCheckResult = { items: [], notFound: [] };

        for (const row of base) {
            // все карточки Озона этого товара: точный goodscode + суффиксные варианты (531557, 531557-10, …)
            const offers = offerMap.get(row.goodscode) ?? [];
            if (offers.length === 0) {
                result.notFound.push(row.goodscode);
                progress.done++;
                continue;
            }
            for (const offerId of offers) {
                result.items.push(await this.checkOffer(offerId, row, dictCache));
            }
            progress.done++;
        }
        return result;
    }

    async updateTnved(items: TnvedCheckItem[], progress: JobProgress = emptyProgress()): Promise<TnvedUpdateResult[]> {
        Object.assign(progress, { phase: 'отправка', done: 0, total: items.length }); // task_id не опрашивается: «отправлено» ≠ «применилось»
        const results: TnvedUpdateResult[] = [];
        for (const item of items as OzonTnvedItem[]) {
            try {
                results.push({ offer: item.offer, taskId: await this.applyFix(item.offer, item.dictValueId, item.markRequired) });
            } catch (e) {
                results.push({ offer: item.offer, error: e?.message ?? String(e) });
            }
            progress.done++;
        }
        return results;
    }

    /** Каталог Озона: offer_id из списка, названия — info/list пачками по 1000 (список названий не отдаёт). */
    async listOffers(progress: JobProgress = emptyProgress()): Promise<TnvedMarketOffer[]> {
        Object.assign(progress, { phase: 'каталог', done: 0, total: undefined });
        const offerMap = await this.loadOfferMap((loaded) => (progress.done = loaded));
        const offers: TnvedMarketOffer[] = [];
        for (const [goodscode, ids] of offerMap) for (const offer of ids) offers.push({ offer, goodscode });

        Object.assign(progress, { phase: 'названия', done: 0, total: offers.length });
        const names = new Map<string, string>();
        for (let i = 0; i < offers.length; i += 1000) {
            const chunk = offers.slice(i, i + 1000);
            try {
                for (const info of await this.productService.infoList(chunk.map((o) => o.offer))) {
                    if (info?.sku) names.set(String(info.sku), info.remark);
                }
            } catch (e) {
                // без названия список всё равно полезен — не роняем задачу
            }
            progress.done = Math.min(i + 1000, offers.length);
        }
        return offers.map((o) => ({ ...o, name: names.get(o.offer) }));
    }

    /** Решение по одной карточке Озона (одному offer_id). */
    private async checkOffer(
        offerId: string,
        { goodscode, tnved, markRequired }: TnvedBaseItem,
        dictCache: Map<string, TnvedVariant[]>,
    ): Promise<OzonTnvedItem> {
        const item: OzonTnvedItem = { offer: offerId, goodscode, current: null, base: tnved, markRequired, ok: false };

        let prod: any;
        try {
            prod = await this.productService.getProductAttributes(offerId);
        } catch (e) {
            return { ...item, ambiguousReason: `info/attributes error: ${e?.message ?? e}` };
        }
        if (!prod) {
            return { ...item, ambiguousReason: 'карточка не отдала атрибуты' };
        }

        const cat = prod.description_category_id;
        const type = prod.type_id;
        const attrs: any[] = prod.attributes || [];
        const tnvedAttr = attrs.find((a) => a.id === this.tnvedAttrId);
        const currentDictId: number | null = tnvedAttr?.values?.[0]?.dictionary_value_id ?? null;
        const currentVal: string = tnvedAttr?.values?.[0]?.value ?? '';
        const currentCode = (/^\s*(\d{4,10})/.exec(currentVal) || [])[1] ?? null;
        const markAttr = attrs.find((a) => a.id === this.markAttrId);
        const markOn = String(markAttr?.values?.[0]?.value ?? '').toLowerCase() === 'true';
        item.name = prod.name;
        item.current = currentCode;

        // Варианты нашего кода в категории карточки. Нет ни одного — код не поддерживается категорией.
        const variantLabel = markRequired ? MARK_LABEL : 'без маркировки';
        const key = `${cat}:${type}:${tnved}`;
        let variants = dictCache.get(key);
        if (variants === undefined) {
            variants = await this.loadTnvedVariants(cat, type, tnved);
            dictCache.set(key, variants);
        }
        if (!variants.length) {
            return { ...item, ambiguousReason: `ТНВЭД ${tnved} не поддерживается категорией ${cat}/${type}` };
        }
        const targetDictId = this.pickVariant(variants, markRequired, currentDictId);

        // ОК = нужный dictionary_value_id И чекбокс маркировки в целевом состоянии (ON для MR=1, OFF для MR=0).
        // Совпадения одних лишь цифр ТНВЭД мало: не тот вариант / не то состояние чекбокса — НЕ ок.
        if (currentDictId === targetDictId && markOn === markRequired) {
            return { ...item, ok: true };
        }

        const reasons: string[] = [];
        if (currentCode !== tnved) reasons.push(`ТНВЭД ${currentCode ?? '—'}→${tnved}`);
        else if (currentDictId !== targetDictId) reasons.push(`вариант «${variantLabel}»`);
        if (markOn !== markRequired) reasons.push(markRequired ? 'включить код маркировки' : 'выключить код маркировки');

        return {
            ...item,
            dictValueId: targetDictId,
            reason: reasons.join('; '),
            action: `set ${tnved} (${variantLabel}) + код маркировки ${markRequired ? 'ON' : 'OFF'}`,
        };
    }

    /** Карта goodscode -> [offer_id…] по всему каталогу Озона (учитывает суффиксные варианты фасовки). */
    private async loadOfferMap(onPage?: (loaded: number) => void): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        let lastId = '';
        let loaded = 0;
        for (let guard = 0; guard < 100; guard++) {
            const res: any = await this.productService.list(lastId, 1000);
            const items: any[] = res?.result?.items ?? [];
            loaded += items.length;
            onPage?.(loaded);
            for (const it of items) {
                const offer = String(it.offer_id ?? '');
                if (!offer) continue;
                const gc = offer.split('-')[0];
                const arr = map.get(gc) ?? [];
                arr.push(offer);
                map.set(gc, arr);
            }
            lastId = res?.result?.last_id ?? '';
            if (!items.length || !lastId) break;
        }
        return map;
    }

    /** Варианты словаря ТНВЭД в категории, значение которых начинается с нашего кода. */
    private async loadTnvedVariants(cat: number, type: number, tnved: string): Promise<TnvedVariant[]> {
        const vals = await this.productService.searchCategoryAttributeValues(this.tnvedAttrId, cat, type, tnved);
        return vals
            .map((v) => ({ id: v.id, value: (v.value ?? '').trim() }))
            .filter((v) => v.value.startsWith(tnved));
    }

    /**
     * Целевой вариант: предпочтительно с «МАРКИРОВКА РФ» для маркируемых и без неё — для остальных;
     * если предпочтительных нет — любой вариант кода. Текущий вариант карточки, если подходит,
     * не трогаем (у Озона бывают дубли, отличающиеся точкой в конце).
     */
    private pickVariant(variants: TnvedVariant[], markRequired: boolean, currentDictId: number | null): number {
        const preferred = variants.filter((v) => v.value.includes(MARK_LABEL) === markRequired);
        const pool = preferred.length ? preferred : variants;
        return pool.find((v) => v.id === currentDictId)?.id ?? pool[0].id;
    }

    /**
     * Записать ТНВЭД (нужный вариант) + выставить «Нужен код маркировки» в целевое состояние.
     * markValue=true для маркируемых, false — для немаркируемых (крыжик активно снимается). task_id.
     */
    private async applyFix(offer: string, dictValueId: number, markValue: boolean): Promise<number | undefined> {
        const res = await this.productService.updateAttributes({
            offer_ids: [offer],
            attributes: [
                { complex_id: 0, id: this.tnvedAttrId, values: [{ dictionary_value_id: dictValueId }] },
                { complex_id: 0, id: this.markAttrId, values: [{ value: String(markValue) }] },
            ],
        });
        await this.productService.evictProductAttributes(offer);
        return res?.[0]?.task_id;
    }
}
