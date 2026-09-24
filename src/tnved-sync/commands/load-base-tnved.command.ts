import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';

/** Источник истины — наша база: все товары с заполненным ТНВЭД + флаг маркируемости → ctx.all. */
@Injectable()
export class LoadBaseTnvedCommand implements IJobCommand<ITnvedProcessingContext> {
    readonly phase = 'база';

    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const offer = context.opts.offer;
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
            context.all = rows.map((r: any) => ({
                goodscode: String(r.GOODSCODE),
                tnved: String(r.TNVED).trim(),
                markRequired: Number(r.MARK_REQUIRED) === 1,
            }));
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
        return context;
    }
}
