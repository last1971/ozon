import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ICardSyncContext } from '../../interfaces/i.card.sync';
import { GtinBaseItem, GtinCheckItem } from '../../interfaces/i.gtin.sync';

/**
 * Источник истины — наша база: все непустые GTIN товара из GOODS_CLASSIF (свой и поставщиков — решение владельца)
 * → ctx.all. Отметка «обработано» — товар + набор GTIN: новый GTIN у уже обработанного товара снова попадёт в прогон.
 */
@Injectable()
export class LoadBaseGtinCommand implements IJobCommand<ICardSyncContext<GtinBaseItem, GtinCheckItem>> {
    readonly phase = 'база';

    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    async execute(
        context: ICardSyncContext<GtinBaseItem, GtinCheckItem>,
    ): Promise<ICardSyncContext<GtinBaseItem, GtinCheckItem>> {
        const offer = context.opts.offer;
        const t = await this.pool.getTransaction();
        try {
            const sql =
                `SELECT c.GOODSCODE, TRIM(c.GTIN) AS GTIN FROM GOODS_CLASSIF c ` +
                `WHERE c.GTIN IS NOT NULL AND TRIM(c.GTIN) <> '' ` +
                (offer ? `AND c.GOODSCODE = ? ` : ``) +
                `ORDER BY c.GOODSCODE, c.GTIN`;
            const rows = await t.query(sql, offer ? [Number(offer)] : [], false);
            await t.commit(true);
            const byGood = new Map<string, string[]>();
            for (const r of rows as any[]) {
                const gc = String(r.GOODSCODE);
                const gtin = String(r.GTIN).trim();
                const list = byGood.get(gc) ?? [];
                if (!list.includes(gtin)) list.push(gtin);
                byGood.set(gc, list);
            }
            context.all = [...byGood].map(([goodscode, gtins]) => ({
                goodscode,
                gtins,
                progressKey: `${goodscode}:${gtins.join('|')}`,
            }));
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
        return context;
    }
}
