import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { OzonApiService } from '../ozon.api/ozon.api.service';

export interface TnvedSyncOptions {
    apply?: boolean; // false = dry-run (только отчёт), true = писать на Озон
    offer?: string; // ограничить одним offer_id (обкатка)
    limit?: number; // ограничить количество товаров
}

export interface TnvedFixItem {
    offer: string;
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
    checked: number;
    toFix: TnvedFixItem[];
    alreadyOk: number;
    notFoundOnOzon: string[];
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
        const report: TnvedSyncReport = {
            apply: !!opts.apply,
            checked: base.length,
            toFix: [],
            alreadyOk: 0,
            notFoundOnOzon: [],
            ambiguous: [],
        };
        // dictionary_value_id варианта «МАРКИРОВКА РФ», ключ (cat:type:tnved) — резолвим один раз
        const dictCache = new Map<string, number | null>();

        for (const { offer, tnved } of base) {
            let prod: any;
            try {
                prod = await this.getProductAttributes(offer);
            } catch (e) {
                report.ambiguous.push({ offer, reason: `info/attributes error: ${e?.message ?? e}` });
                continue;
            }
            if (!prod) {
                report.notFoundOnOzon.push(offer);
                continue;
            }

            const cat = prod.description_category_id;
            const type = prod.type_id;
            const attr = (prod.attributes || []).find((a: any) => a.id === this.tnvedAttrId);
            const currentVal: string = attr?.values?.[0]?.value ?? '';
            const currentCode = (/^\s*(\d{4,10})/.exec(currentVal) || [])[1] ?? null;

            if (currentCode === tnved) {
                report.alreadyOk++;
                continue;
            }

            const key = `${cat}:${type}:${tnved}`;
            let dictId = dictCache.get(key);
            if (dictId === undefined) {
                dictId = await this.resolveMarkDictValue(cat, type, tnved);
                dictCache.set(key, dictId);
            }
            if (!dictId) {
                report.ambiguous.push({
                    offer,
                    reason: `нет варианта «${MARK_LABEL}» для ТНВЭД ${tnved} (cat ${cat}/${type})`,
                });
                continue;
            }

            const fix: TnvedFixItem = {
                offer,
                name: prod.name,
                ozon: currentCode,
                base: tnved,
                dictValueId: dictId,
                action: `set ${tnved} (${MARK_LABEL}) + Нужен код маркировки`,
            };

            if (opts.apply) {
                try {
                    const res = await this.applyFix(offer, dictId);
                    fix.taskId = res?.task_id;
                } catch (e) {
                    fix.error = e?.message ?? String(e);
                }
            }
            report.toFix.push(fix);
        }

        this.logger.log(
            `[tnved-sync] apply=${report.apply} checked=${report.checked} toFix=${report.toFix.length} ` +
                `ok=${report.alreadyOk} notFound=${report.notFoundOnOzon.length} ambiguous=${report.ambiguous.length}`,
        );
        return report;
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

    /** Свежие атрибуты товара с Озона (без кэша — решение о правке должно быть на актуальных данных). */
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
