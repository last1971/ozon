import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ITnvedUpdateable, TnvedBaseItem, TnvedCheckItem } from '../interfaces/i.tnved.updateable';
import { OzonTnvedService } from './ozon.tnved.service';

export interface TnvedSyncOptions {
    apply?: boolean; // false = dry-run (только отчёт), true = писать на маркетплейс
    offer?: string; // ограничить одним GOODSCODE (обкатка) — берутся все его варианты
    limit?: number; // ограничить количество товаров базы
}

export interface TnvedFixItem extends TnvedCheckItem {
    taskId?: number; // после apply
    error?: string; // после apply
}

export interface TnvedSyncReport {
    apply: boolean;
    checkedGoods: number; // товаров из базы
    checkedOffers: number; // карточек на маркетплейсе (с учётом суффиксных вариантов)
    toFix: TnvedFixItem[];
    alreadyOk: number;
    notFoundOnOzon: string[]; // goodscode, у которых на маркетплейсе нет ни одной карточки
    ambiguous: { offer: string; reason: string }[];
}

/**
 * Общая часть сверки ТН ВЭД: база (истина) → маркетплейс читает и решает по каждой карточке →
 * отчёт «уже ок / на правку / нет карточки / спорно» → по команде маркетплейс пишет.
 * Про Озон и ВБ не знает ничего, только договор ITnvedUpdateable. Карта сервисов — как в ExtraPriceService.
 */
@Injectable()
export class TnvedSyncService {
    private readonly logger = new Logger(TnvedSyncService.name);
    private readonly services = new Map<GoodServiceEnum, ITnvedUpdateable>();

    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        ozon: OzonTnvedService,
        config: ConfigService,
    ) {
        const services = config.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) this.services.set(GoodServiceEnum.OZON, ozon);
    }

    public getService(service: GoodServiceEnum): ITnvedUpdateable | null {
        return this.services.get(service) || null;
    }

    async sync(opts: TnvedSyncOptions = {}, market: GoodServiceEnum = GoodServiceEnum.OZON): Promise<TnvedSyncReport> {
        const service = this.getService(market);
        if (!service) throw new Error(`Service ${market} does not support TNVED operations`);

        const base = await this.loadBaseTnved(opts.offer, opts.limit);
        const { items, notFound } = await service.checkTnved(base);
        const report: TnvedSyncReport = {
            apply: !!opts.apply,
            checkedGoods: base.length,
            checkedOffers: items.length,
            toFix: [],
            alreadyOk: 0,
            notFoundOnOzon: notFound,
            ambiguous: [],
        };

        for (const item of items) {
            if (item.ambiguousReason) report.ambiguous.push({ offer: item.offer, reason: item.ambiguousReason });
            else if (item.ok) report.alreadyOk++;
            else report.toFix.push({ ...item });
        }

        if (opts.apply && report.toFix.length) {
            const results = await service.updateTnved(report.toFix);
            for (const fix of report.toFix) {
                const r = results.find((x) => x.offer === fix.offer);
                if (!r) continue;
                if (r.taskId !== undefined) fix.taskId = r.taskId;
                if (r.error) fix.error = r.error;
            }
        }

        this.logger.log(
            `[tnved-sync] ${market} apply=${report.apply} goods=${report.checkedGoods} offers=${report.checkedOffers} ` +
                `toFix=${report.toFix.length} ok=${report.alreadyOk} notFound=${report.notFoundOnOzon.length} ` +
                `ambiguous=${report.ambiguous.length}`,
        );
        return report;
    }

    /** Источник истины — наша база: все товары с заполненным ТНВЭД + флаг маркируемости. */
    private async loadBaseTnved(offer?: string, limit?: number): Promise<TnvedBaseItem[]> {
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
                goodscode: String(r.GOODSCODE),
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
}
