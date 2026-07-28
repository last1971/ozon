import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { ProductService } from '../product/product.service';

export interface TnvedSyncOptions {
    apply?: boolean; // false = dry-run (только отчёт), true = писать на Озон
    offer?: string; // ограничить одним GOODSCODE (обкатка) — берутся все его варианты
    limit?: number; // ограничить количество товаров базы
}

export interface TnvedFixItem {
    offer: string; // конкретный offer_id на Озоне (может быть суффиксным)
    goodscode: string;
    name?: string;
    ozon: string | null; // текущий ТНВЭД на Озоне
    base: string; // наш ТНВЭД из базы
    markRequired?: boolean; // маркируемый ли товар (определяет вариант ТНВЭД и состояние чекбокса)
    dictValueId?: number; // dictionary_value_id целевого варианта ТНВЭД
    reason: string; // почему считается требующим правки
    action: string;
    taskId?: number; // после apply
    error?: string; // после apply
}

export interface TnvedSyncReport {
    apply: boolean;
    checkedGoods: number; // товаров из базы
    checkedOffers: number; // карточек на Озоне (с учётом суффиксных вариантов)
    toFix: TnvedFixItem[];
    alreadyOk: number;
    notFoundOnOzon: string[]; // goodscode, у которых на Озоне нет ни одной карточки
    ambiguous: { offer: string; reason: string }[];
}

const MARK_LABEL = 'МАРКИРОВКА РФ';

/**
 * Сверка ТНВЭД всех товаров с Озоном и (опц.) автоправка. Ветвится по MARK_REQUIRED:
 *   - маркируемый (MR=1)   → вариант ТНВЭД «МАРКИРОВКА РФ» + чекбокс «Нужен код маркировки» ON;
 *   - немаркируемый (MR=0) → плоский вариант ТНВЭД (без «МАРКИРОВКА РФ») + чекбокс OFF.
 * Обе ветки — один поток, разница только во флаге markRequired (предикат выбора значения
 * и целевое состояние чекбокса). Оркестрирует: база (истина) + ProductService (весь Ozon).
 */
@Injectable()
export class TnvedSyncService {
    private readonly logger = new Logger(TnvedSyncService.name);
    private readonly tnvedAttrId: number;
    private readonly markAttrId: number;

    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly productService: ProductService,
        config: ConfigService,
    ) {
        // ТН ВЭД коды ЕАЭС / «Нужен код маркировки» — id атрибутов Ozon (глобальные, вынесены в конфиг)
        this.tnvedAttrId = config.get<number>('OZON_TNVED_ATTR_ID', 22232);
        this.markAttrId = config.get<number>('OZON_MARK_REQUIRED_ATTR_ID', 23536);
    }

    async sync(opts: TnvedSyncOptions = {}): Promise<TnvedSyncReport> {
        const base = await this.loadBaseTnved(opts.offer, opts.limit);
        const offerMap = await this.loadOzonOfferMap();
        const report: TnvedSyncReport = {
            apply: !!opts.apply,
            checkedGoods: base.length,
            checkedOffers: 0,
            toFix: [],
            alreadyOk: 0,
            notFoundOnOzon: [],
            ambiguous: [],
        };
        // dictionary_value_id варианта «МАРКИРОВКА РФ», ключ (cat:type:tnved) — резолвим один раз
        const dictCache = new Map<string, number | null>();

        for (const { offer: goodscode, tnved, markRequired } of base) {
            // все карточки Озона этого товара: точный goodscode + суффиксные варианты (531557, 531557-10, …)
            const offers = offerMap.get(goodscode) ?? [];
            if (offers.length === 0) {
                report.notFoundOnOzon.push(goodscode);
                continue;
            }
            for (const offerId of offers) {
                report.checkedOffers++;
                await this.processOffer(offerId, goodscode, tnved, markRequired, dictCache, report, !!opts.apply);
            }
        }

        this.logger.log(
            `[tnved-sync] apply=${report.apply} goods=${report.checkedGoods} offers=${report.checkedOffers} ` +
                `toFix=${report.toFix.length} ok=${report.alreadyOk} notFound=${report.notFoundOnOzon.length} ` +
                `ambiguous=${report.ambiguous.length}`,
        );
        return report;
    }

    /** Сверка/правка одной карточки Озона (одного offer_id). */
    private async processOffer(
        offerId: string,
        goodscode: string,
        tnved: string,
        markRequired: boolean,
        dictCache: Map<string, number | null>,
        report: TnvedSyncReport,
        apply: boolean,
    ): Promise<void> {
        let prod: any;
        try {
            prod = await this.productService.getProductAttributes(offerId);
        } catch (e) {
            report.ambiguous.push({ offer: offerId, reason: `info/attributes error: ${e?.message ?? e}` });
            return;
        }
        if (!prod) {
            report.ambiguous.push({ offer: offerId, reason: 'карточка не отдала атрибуты' });
            return;
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

        // Целевой вариант ТНВЭД в категории карточки: с «МАРКИРОВКА РФ» для маркируемых,
        // плоский — для немаркируемых. Ключ кэша включает markRequired: варианты разные.
        const variantLabel = markRequired ? MARK_LABEL : 'без маркировки';
        const key = `${cat}:${type}:${tnved}:${markRequired}`;
        let targetDictId = dictCache.get(key);
        if (targetDictId === undefined) {
            targetDictId = await this.resolveTnvedDictValue(cat, type, tnved, markRequired);
            dictCache.set(key, targetDictId);
        }
        if (!targetDictId) {
            report.ambiguous.push({
                offer: offerId,
                reason: `нет варианта «${variantLabel}» для ТНВЭД ${tnved} (cat ${cat}/${type})`,
            });
            return;
        }

        // ОК = нужный dictionary_value_id И чекбокс маркировки в целевом состоянии (ON для MR=1, OFF для MR=0).
        // Совпадения одних лишь цифр ТНВЭД мало: не тот вариант / не то состояние чекбокса — НЕ ок.
        if (currentDictId === targetDictId && markOn === markRequired) {
            report.alreadyOk++;
            return;
        }

        const reasons: string[] = [];
        if (currentCode !== tnved) reasons.push(`ТНВЭД ${currentCode ?? '—'}→${tnved}`);
        else if (currentDictId !== targetDictId) reasons.push(`вариант «${variantLabel}»`);
        if (markOn !== markRequired) reasons.push(markRequired ? 'включить код маркировки' : 'выключить код маркировки');

        const fix: TnvedFixItem = {
            offer: offerId,
            goodscode,
            name: prod.name,
            ozon: currentCode,
            base: tnved,
            markRequired,
            dictValueId: targetDictId,
            reason: reasons.join('; '),
            action: `set ${tnved} (${variantLabel}) + код маркировки ${markRequired ? 'ON' : 'OFF'}`,
        };

        if (apply) {
            try {
                fix.taskId = await this.applyFix(offerId, targetDictId, markRequired);
            } catch (e) {
                fix.error = e?.message ?? String(e);
            }
        }
        report.toFix.push(fix);
    }

    /** Источник истины — наша база: все товары с заполненным ТНВЭД + флаг маркируемости. */
    private async loadBaseTnved(
        offer?: string,
        limit?: number,
    ): Promise<{ offer: string; tnved: string; markRequired: boolean }[]> {
        const t = await this.pool.getTransaction();
        try {
            // MAX(MARK_REQUIRED): если хоть один вариант товара маркируемый — считаем товар маркируемым.
            const sql =
                `SELECT c.GOODSCODE, MIN(TRIM(c.TNVED)) AS TNVED, MAX(c.MARK_REQUIRED) AS MARK_REQUIRED ` +
                `FROM GOODS_CLASSIF c ` +
                `WHERE c.TNVED IS NOT NULL AND TRIM(c.TNVED) <> '' ` +
                (offer ? `AND c.GOODSCODE = ? ` : ``) +
                `GROUP BY c.GOODSCODE`;
            const rows = await t.query(sql, offer ? [Number(offer)] : [], false);
            await t.commit(true);
            let list = rows.map((r: any) => ({
                offer: String(r.GOODSCODE),
                tnved: String(r.TNVED).trim(),
                markRequired: Number(r.MARK_REQUIRED) === 1,
            }));
            if (limit && limit > 0) list = list.slice(0, limit);
            return list;
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
    }

    /** Карта goodscode -> [offer_id…] по всему каталогу Озона (учитывает суффиксные варианты фасовки). */
    private async loadOzonOfferMap(): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        let lastId = '';
        for (let guard = 0; guard < 100; guard++) {
            const res: any = await this.productService.list(lastId, 1000);
            const items: any[] = res?.result?.items ?? [];
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

    /**
     * dictionary_value_id варианта ТНВЭД в категории товара.
     * markRequired=true  → вариант, содержащий «МАРКИРОВКА РФ»;
     * markRequired=false → плоский вариант (без «МАРКИРОВКА РФ»).
     */
    private async resolveTnvedDictValue(
        cat: number,
        type: number,
        tnved: string,
        markRequired: boolean,
    ): Promise<number | null> {
        const vals = await this.productService.searchCategoryAttributeValues(this.tnvedAttrId, cat, type, tnved);
        const match = vals.find((v) => {
            const val = (v.value ?? '').trim();
            return val.startsWith(tnved) && (v.value ?? '').includes(MARK_LABEL) === markRequired;
        });
        return match?.id ?? null;
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
        return res?.[0]?.task_id;
    }
}
