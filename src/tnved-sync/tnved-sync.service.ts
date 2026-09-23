import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ITnvedUpdateable, TnvedBaseItem, TnvedCheckItem } from '../interfaces/i.tnved.updateable';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';

export interface TnvedSyncOptions {
    market: GoodServiceEnum; // маркетплейс, обязателен: значение по умолчанию скрывало бы, куда идёт прогон
    apply?: boolean; // false = dry-run (только отчёт), true = писать на маркетплейс
    offer?: string; // ограничить одним GOODSCODE (обкатка) — берутся все его варианты
    limit?: number; // ограничить количество товаров базы (при onlyNew — следующие N необработанных)
    onlyNew?: boolean; // пропустить товары, уже помеченные обработанными (прогресс раскатки в Redis)
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
    skippedProcessed: number; // товаров базы пропущено как уже обработанные (onlyNew)
    remaining: number; // товаров базы ещё не обработано после этого прогона
}

/** Имя набора в ProcessedCacheService: ключ processed:tnved:<market>, значения — goodscode. */
const PROGRESS_CACHE = 'tnved';

/**
 * Общая часть сверки ТН ВЭД: база (истина) → маркетплейс читает и решает по каждой карточке →
 * отчёт «уже ок / на правку / нет карточки / спорно» → по команде маркетплейс пишет.
 * Про Озон и ВБ не знает ничего, только договор ITnvedUpdateable. Карта сервисов — как в ExtraPriceService.
 * Прогресс раскатки — ProcessedCacheService (Redis): после записи товар, у которого все карточки «ок»
 * или записаны без ошибки, помечается обработанным; onlyNew + limit = «следующие N необработанных».
 */
@Injectable()
export class TnvedSyncService {
    private readonly logger = new Logger(TnvedSyncService.name);
    private readonly services = new Map<GoodServiceEnum, ITnvedUpdateable>();

    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        ozon: OzonTnvedService,
        wb: WbTnvedService,
        private readonly progress: ProcessedCacheService,
        config: ConfigService,
    ) {
        const services = config.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) this.services.set(GoodServiceEnum.OZON, ozon);
        if (services.includes(GoodServiceEnum.WB)) this.services.set(GoodServiceEnum.WB, wb);
    }

    public getService(service: GoodServiceEnum): ITnvedUpdateable | null {
        return this.services.get(service) || null;
    }

    /** Сбросить прогресс раскатки по маркетплейсу — следующий onlyNew-прогон пойдёт с нуля. */
    async clearProgress(market: GoodServiceEnum): Promise<void> {
        await this.progress.clear(PROGRESS_CACHE, market);
    }

    async sync(opts: TnvedSyncOptions): Promise<TnvedSyncReport> {
        const market = opts.market;
        const service = this.getService(market);
        if (!service) {
            throw new BadRequestException(
                `маркетплейс «${market}» не поддерживает ТН ВЭД; доступны: ${[...this.services.keys()].join(', ') || 'нет'}`,
            );
        }

        const processed = await this.progress.load(PROGRESS_CACHE, market);
        const all = await this.loadBaseTnved(opts.offer);
        const fresh = opts.onlyNew ? all.filter((b) => !processed.has(b.goodscode)) : all;
        const base = opts.limit && opts.limit > 0 ? fresh.slice(0, opts.limit) : fresh;

        const { items, notFound } = await service.checkTnved(base);
        const report: TnvedSyncReport = {
            apply: !!opts.apply,
            checkedGoods: base.length,
            checkedOffers: items.length,
            toFix: [],
            alreadyOk: 0,
            notFoundOnOzon: notFound,
            ambiguous: [],
            skippedProcessed: all.length - fresh.length,
            remaining: 0,
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
        if (opts.apply) {
            for (const gc of this.completedGoods(base, items, notFound, report.toFix)) processed.add(gc);
            await this.progress.save(PROGRESS_CACHE, market, processed);
        }
        report.remaining = all.filter((b) => !processed.has(b.goodscode)).length;

        this.logger.log(
            `[tnved-sync] ${market} apply=${report.apply} goods=${report.checkedGoods} offers=${report.checkedOffers} ` +
                `toFix=${report.toFix.length} ok=${report.alreadyOk} notFound=${report.notFoundOnOzon.length} ` +
                `ambiguous=${report.ambiguous.length}`,
        );
        return report;
    }

    /**
     * Товары прогона, которые считаем закрытыми: есть карточки, ни одна не спорная,
     * каждая либо «уже ок», либо записана без ошибки. Остальные всплывут в следующем onlyNew-прогоне.
     */
    private completedGoods(
        base: TnvedBaseItem[],
        items: TnvedCheckItem[],
        notFound: string[],
        fixes: TnvedFixItem[],
    ): string[] {
        const failed = new Set<string>();
        for (const it of items) if (it.ambiguousReason) failed.add(it.goodscode);
        for (const f of fixes) if (f.error) failed.add(f.goodscode);
        for (const gc of notFound) failed.add(gc);
        return base.map((b) => b.goodscode).filter((gc) => !failed.has(gc));
    }

    /** Источник истины — наша база: все товары с заполненным ТНВЭД + флаг маркируемости. */
    private async loadBaseTnved(offer?: string): Promise<TnvedBaseItem[]> {
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
            return rows.map((r: any) => ({
                goodscode: String(r.GOODSCODE),
                tnved: String(r.TNVED).trim(),
                markRequired: Number(r.MARK_REQUIRED) === 1,
            }));
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
    }
}
