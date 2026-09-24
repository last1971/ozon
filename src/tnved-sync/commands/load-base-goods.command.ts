import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IMissingTnvedContext } from '../../interfaces/i.missing.tnved.context';

/**
 * Два множества из базы: все коды товаров (GOODS) и коды с заполненным ТН ВЭД (GOODS_CLASSIF).
 * Наличие GOODS_CLASSIF проверяется по RDB$RELATIONS, как GoodClassif::tableExists в Trade: без таблицы — «с ТН ВЭД» пусто.
 */
@Injectable()
export class LoadBaseGoodsCommand implements IJobCommand<IMissingTnvedContext> {
    readonly phase = 'база';

    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    async execute(context: IMissingTnvedContext): Promise<IMissingTnvedContext> {
        const t = await this.pool.getTransaction();
        try {
            const goods = await t.query('SELECT GOODSCODE FROM GOODS', [], false);
            context.allGoods = new Set(goods.map((r: any) => String(r.GOODSCODE)));

            const exists = await t.query(
                "SELECT 1 AS X FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'GOODS_CLASSIF'",
                [],
                false,
            );
            const classif = exists.length
                ? await t.query(
                      `SELECT DISTINCT GOODSCODE FROM GOODS_CLASSIF WHERE TNVED IS NOT NULL AND TRIM(TNVED) <> ''`,
                      [],
                      false,
                  )
                : [];
            context.withTnved = new Set(classif.map((r: any) => String(r.GOODSCODE)));
            await t.commit(true);
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
        return context;
    }
}
