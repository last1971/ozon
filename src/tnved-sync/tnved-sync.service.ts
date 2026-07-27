import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { OzonApiService } from '../ozon.api/ozon.api.service';

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

@Injectable()
export class TnvedSyncService {
    private readonly logger = new Logger(TnvedSyncService.name);
    private readonly tnvedAttrId: number;
    private readonly markAttrId: number;

    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly ozonApi: OzonApiService,
        config: ConfigService,
    ) {
        // ТН ВЭД коды ЕАЭС / «Нужен код маркировки» — id атрибутов Ozon (глобальные, но вынесены в конфиг)
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
            prod = await this.getProductAttributes(offerId);
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
        const attr = (prod.attributes || []).find((a: any) => a.id === this.tnvedAttrId);
        const currentVal: string = attr?.values?.[0]?.value ?? '';
        const currentCode = (/^\s*(\d{4,10})/.exec(currentVal) || [])[1] ?? null;

        if (currentCode === tnved) {
            report.alreadyOk++;
            return;
        }

        const key = `${cat}:${type}:${tnved}`;
        let dictId = dictCache.get(key);
        if (dictId === undefined) {
            dictId = await this.resolveMarkDictValue(cat, type, tnved);
            dictCache.set(key, dictId);
        }
        if (!dictId) {
            report.ambiguous.push({
                offer: offerId,
                reason: `нет варианта «${MARK_LABEL}» для ТНВЭД ${tnved} (cat ${cat}/${type})`,
            });
            return;
        }

        const fix: TnvedFixItem = {
            offer: offerId,
            goodscode,
            name: prod.name,
            ozon: currentCode,
            base: tnved,
            dictValueId: dictId,
            action: `set ${tnved} (${MARK_LABEL}) + Нужен код маркировки`,
        };

        if (apply) {
            try {
                const res = await this.applyFix(offerId, dictId);
                fix.taskId = res?.task_id;
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
            const res = await this.ozonApi.method('/v3/product/list', {
                filter: { visibility: 'ALL' },
                last_id: lastId,
                limit: 1000,
            });
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

    /** Свежие атрибуты карточки с Озона (без кэша — решение о правке должно быть на актуальных данных). */
    private async getProductAttributes(offer: string): Promise<any> {
        const res = await this.ozonApi.method('/v4/product/info/attributes', {
            filter: { offer_id: [offer], visibility: 'ALL' },
            limit: 1,
        });
        return res?.result?.[0] ?? res?.items?.[0] ?? null;
    }

    /** dictionary_value_id варианта «МАРКИРОВКА РФ» для данного ТНВЭД в категории товара. */
    private async resolveMarkDictValue(cat: number, type: number, tnved: string): Promise<number | null> {
        const res = await this.ozonApi.method('/v1/description-category/attribute/values/search', {
            description_category_id: cat,
            type_id: type,
            attribute_id: this.tnvedAttrId,
            value: tnved,
            limit: 50,
        });
        const vals: any[] = res?.result ?? [];
        const marked = vals.find(
            (v) => (v.value ?? '').includes(MARK_LABEL) && (v.value ?? '').trim().startsWith(tnved),
        );
        return marked?.id ?? null;
    }

    /** Записать ТНВЭД (вариант с маркировкой) + включить «Нужен код маркировки». */
    private async applyFix(offer: string, dictValueId: number): Promise<any> {
        return this.ozonApi.method('/v1/product/attributes/update', {
            items: [
                {
                    offer_id: offer,
                    attributes: [
                        { id: this.tnvedAttrId, values: [{ dictionary_value_id: dictValueId }] },
                        { id: this.markAttrId, values: [{ value: 'true' }] },
                    ],
                },
            ],
        });
    }
}
