import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { ILossHistorySource, LossCounts, LossHistoryPage } from '../../marketplace-loss/loss.contracts';
import { LossPeriod, lossDate, lossOfferKey } from '../../helpers/price/marketplace.loss.stats';
import { jobCheckpoint } from '../../job/job.checkpoint';

/** Продажи из существующих счетов по правилу владельца: статусы 4 и 5.
 * Источник не содержит оплаченных возвратов; их количество и доля остаются неизвестными.
 */
export class YandexFirebirdSalesSource implements ILossHistorySource {
    readonly service = 'YANDEX';
    readonly preliminary = true;
    readonly returnsKnown = false;

    constructor(
        private readonly pool: FirebirdPool,
        private readonly buyerId: number,
        private readonly period: LossPeriod,
    ) {}

    async readPage(cursor: string): Promise<LossHistoryPage> {
        if (cursor !== this.period.from) throw new Error('Некорректный курсор Яндекс');
        if (!Number.isSafeInteger(Number(this.buyerId)) || Number(this.buyerId) <= 0)
            throw new Error('Некорректный покупатель Яндекс');
        await jobCheckpoint();
        const t = await this.pool.getTransaction(ISOLATION_READ_COMMITTED_READ_ONLY);
        let rows: any[];
        try {
            // Строки отдельно: сумма не должна скрывать дробную упаковку или неизвестную фасовку.
            rows = await t.query(
                `SELECT R.GOODSCODE, R.PIECES, R.QUAN AS TOTAL_QUAN
                 FROM S
                 INNER JOIN REALPRICE R ON R.SCODE = S.SCODE
                 WHERE S.POKUPATCODE = ? AND S.STATUS IN (4, 5)
                   AND S.DATA >= ? AND S.DATA < ?`,
                [this.buyerId, new Date(lossDate(this.period.from)), new Date(lossDate(this.period.to))],
                false,
            );
        } finally {
            await t.rollback(true);
        }
        if (!Array.isArray(rows)) throw new Error('Некорректный ответ Firebird при загрузке продаж Яндекс');
        const totals = new Map<string, LossCounts>();
        const excluded = new Map<string, string>();
        for (let i = 0; i < rows.length; i++) {
            if (i % 500 === 0) await jobCheckpoint();
            const r = rows[i];
            // GOODSCODE — код товара, а не артикул с фасовкой: «123-1» нельзя превращать в «123».
            const code = String(r.GOODSCODE);
            if (!/^[1-9]\d*$/.test(code) || code !== code.trim()) throw new Error('Некорректный код товара REALPRICE');
            const goodscode = lossOfferKey(code);
            const pieces = Number(r.PIECES);
            const quantity = Number(r.TOTAL_QUAN);
            if (r.TOTAL_QUAN === null || !Number.isSafeInteger(quantity) || quantity < 0)
                throw new Error(`Некорректное количество REALPRICE: ${r.TOTAL_QUAN}`);
            if (quantity === 0) continue;
            if (r.PIECES === null || !Number.isSafeInteger(pieces) || pieces <= 0 || quantity % pieces !== 0) {
                excluded.set(goodscode, 'Неизвестна фасовка или количество не кратно упаковке');
                continue;
            }
            const offerId = pieces === 1 ? goodscode : `${goodscode}-${pieces}`;
            const count = totals.get(offerId) ?? { offerId, soldUnits: 0, returnedUnits: null };
            count.soldUnits += quantity / pieces;
            totals.set(offerId, count);
        }
        return {
            operations: [],
            counts: [...totals.values()].filter((r) => !excluded.has(r.offerId.split('-')[0])),
            excludedGoods: [...excluded].map(([goodscode, reason]) => ({ goodscode, reason })),
            next: null,
        };
    }
}
