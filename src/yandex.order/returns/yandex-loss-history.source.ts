import { Inject } from '@nestjs/common';
import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { ILossHistorySource, LossCounts, LossHistoryPage } from '../../marketplace-loss/loss.contracts';
import { LossPeriod, lossDate } from '../../helpers/price/marketplace.loss.stats';
import { jobCheckpoint } from '../../job/job.checkpoint';

/**
 * Источник продаж Яндекс.Маркета из Firebird (таблица S + REALPRICE, STATUS=4, покупатель по buyerId).
 * Охват — ровно 90 дней периода. preliminary=false: данные полные (каждый выполненный заказ
 * создаёт инвойс; возвраты считаются отдельно через MpReturnAcceptStore).
 * returnedUnits всегда 0: данные о возвратах в этот источник не входят.
 */
export class YandexFirebirdSalesSource implements ILossHistorySource {
    readonly service = 'YANDEX';
    readonly preliminary = false;

    constructor(
        private readonly pool: FirebirdPool,
        private readonly buyerId: number,
        private readonly period: LossPeriod,
    ) {}

    async readPage(cursor: string): Promise<LossHistoryPage> {
        if (cursor !== this.period.from) throw new Error('Некорректный курсор Яндекс');
        await jobCheckpoint();
        const from = new Date(lossDate(this.period.from));
        const to = new Date(lossDate(this.period.to));
        const t = await this.pool.getTransaction(ISOLATION_READ_COMMITTED_READ_ONLY);
        let rows: any[];
        try {
            rows = await t.query(
                `SELECT R.GOODSCODE, R.PIECES, SUM(R.QUAN) AS TOTAL_QUAN
                 FROM S
                 INNER JOIN REALPRICE R ON R.SCODE = S.SCODE
                 WHERE S.POKUPATCODE = ? AND S.STATUS = 4
                   AND S.DATA >= ? AND S.DATA < ?
                 GROUP BY R.GOODSCODE, R.PIECES`,
                [this.buyerId, from, to],
                false,
            );
        } finally {
            await t.rollback(true);
        }
        if (!Array.isArray(rows)) throw new Error('Некорректный ответ Firebird при загрузке продаж Яндекс');
        const counts: LossCounts[] = [];
        for (const r of rows) {
            const goodscode = String(r.GOODSCODE);
            const pieces = Number(r.PIECES);
            const totalQuan = Number(r.TOTAL_QUAN);
            if (!goodscode || !Number.isInteger(pieces) || pieces <= 0)
                throw new Error(`Некорректная строка REALPRICE: goodscode=${r.GOODSCODE}, pieces=${r.PIECES}`);
            if (!Number.isFinite(totalQuan) || totalQuan < 0)
                throw new Error(`Некорректное количество REALPRICE: ${totalQuan}`);
            if (totalQuan === 0) continue;
            // soldUnits = количество упаковок; quan = units × pieces
            const soldUnits = totalQuan % pieces === 0 ? totalQuan / pieces : Math.round(totalQuan / pieces);
            const offerId = pieces === 1 ? goodscode : `${goodscode}-${pieces}`;
            counts.push({ offerId, soldUnits, returnedUnits: 0 });
        }
        return { operations: [], counts, next: null };
    }
}
