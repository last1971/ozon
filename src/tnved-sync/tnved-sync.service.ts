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
    dictValueId?: number; // dictionary_value_id варианта «МАРКИРОВКА РФ»
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
 * Сверка ТНВЭД маркируемых товаров с Озоном и (опц.) автоправка.
 * Оркестрирует: база (источник истины) + ProductService (все операции с Озоном).
 * Собственных вызовов Ozon API не делает — только через ProductService.
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

        for (const { offer: goodscode, tnved } of base) {
            // все карточки Озона этого товара: точный goodscode + суффиксные варианты (531557, 531557-10, …)
            const offers = offerMap.get(goodscode) ?? [];
            if (offers.length === 0) {
                report.notFoundOnOzon.push(goodscode);
                continue;
            }
            for (const offerId of offers) {
                report.checkedOffers++;
                await this.processOffer(offerId, goodscode, tnved, dictCache, report, !!opts.apply);
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

        // Целевой вариант «МАРКИРОВКА РФ» нашего ТНВЭД в категории карточки
        const key = `${cat}:${type}:${tnved}`;
        let targetDictId = dictCache.get(key);
        if (targetDictId === undefined) {
            targetDictId = await this.resolveMarkDictValue(cat, type, tnved);
            dictCache.set(key, targetDictId);
        }
        if (!targetDictId) {
            report.ambiguous.push({
                offer: offerId,
                reason: `нет варианта «${MARK_LABEL}» для ТНВЭД ${tnved} (cat ${cat}/${type})`,
            });
            return;
        }

        // ОК = ровно нужный dictionary_value_id (вариант с маркировкой) И включённый чекбокс маркировки.
        // Совпадения одних лишь цифр ТНВЭД мало: плоский вариант без «МАРКИРОВКА РФ» / выключенный чекбокс — это НЕ ок.
        if (currentDictId === targetDictId && markOn) {
            report.alreadyOk++;
            return;
        }

        const reasons: string[] = [];
        if (currentCode !== tnved) reasons.push(`ТНВЭД ${currentCode ?? '—'}→${tnved}`);
        else if (currentDictId !== targetDictId) reasons.push(`вариант без «${MARK_LABEL}»`);
        if (!markOn) reasons.push('чекбокс маркировки выкл');

        const fix: TnvedFixItem = {
            offer: offerId,
            goodscode,
            name: prod.name,
            ozon: currentCode,
            base: tnved,
            dictValueId: targetDictId,
            reason: reasons.join('; '),
            action: `set ${tnved} (${MARK_LABEL}) + Нужен код маркировки`,
        };

        if (apply) {
            try {
                fix.taskId = await this.applyFix(offerId, targetDictId);
            } catch (e) {
                fix.error = e?.message ?? String(e);
            }
        }
        report.toFix.push(fix);
    }

    /** Источник истины — наша база: маркируемые товары с заполненным ТНВЭД. */
    private async loadBaseTnved(offer?: string, limit?: number): Promise<{ offer: string; tnved: string }[]> {
        const t = await this.pool.getTransaction();
        try {
            const sql =
                `SELECT g.GOODSCODE, MIN(TRIM(c.TNVED)) AS TNVED ` +
                `FROM (SELECT DISTINCT GOODSCODE FROM GOODS_CLASSIF WHERE MARK_REQUIRED = 1) g ` +
                `JOIN GOODS_CLASSIF c ON c.GOODSCODE = g.GOODSCODE ` +
                `AND c.TNVED IS NOT NULL AND TRIM(c.TNVED) <> '' ` +
                (offer ? `WHERE g.GOODSCODE = ? ` : ``) +
                `GROUP BY g.GOODSCODE`;
            const rows = await t.query(sql, offer ? [Number(offer)] : [], false);
            await t.commit(true);
            let list = rows.map((r: any) => ({ offer: String(r.GOODSCODE), tnved: String(r.TNVED).trim() }));
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

    /** dictionary_value_id варианта «МАРКИРОВКА РФ» для данного ТНВЭД в категории товара. */
    private async resolveMarkDictValue(cat: number, type: number, tnved: string): Promise<number | null> {
        const vals = await this.productService.searchCategoryAttributeValues(this.tnvedAttrId, cat, type, tnved);
        const marked = vals.find(
            (v) => (v.value ?? '').includes(MARK_LABEL) && (v.value ?? '').trim().startsWith(tnved),
        );
        return marked?.id ?? null;
    }

    /** Записать ТНВЭД (вариант с маркировкой) + включить «Нужен код маркировки». Возвращает task_id. */
    private async applyFix(offer: string, dictValueId: number): Promise<number | undefined> {
        const res = await this.productService.updateAttributes({
            offer_ids: [offer],
            attributes: [
                { complex_id: 0, id: this.tnvedAttrId, values: [{ dictionary_value_id: dictValueId }] },
                { complex_id: 0, id: this.markAttrId, values: [{ value: 'true' }] },
            ],
        });
        return res?.[0]?.task_id;
    }
}
