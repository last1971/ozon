import { ILossHistorySource, LossOperation } from '../../marketplace-loss/loss.contracts';
import { LossPeriod, MarketplaceLossAccumulator, lossDate } from '../../helpers/price/marketplace.loss.stats';
import { WbOrderService } from '../wb.order.service';
import { jobCheckpoint } from '../../job/job.checkpoint';

export function normalizeWbLoss(raw: unknown): LossOperation {
    const r = raw as Record<string, unknown>;
    if (
        !r ||
        typeof r.saleID !== 'string' ||
        !/^[SR].+/.test(r.saleID) ||
        typeof r.supplierArticle !== 'string' ||
        typeof r.srid !== 'string' ||
        !r.srid.trim()
    )
        throw new Error('Некорректная строка продаж/возвратов ВБ');
    return {
        id: r.saleID,
        offerId: r.supplierArticle.trim(),
        kind: r.saleID[0] === 'S' ? 'sale' : 'return',
        units: 1,
        occurredAt: r.date as string,
        changedAt: r.lastChangeDate as string,
        orderId: r.srid,
    };
}
export class WbLossHistorySource implements ILossHistorySource {
    readonly service = 'WB';
    readonly preliminary = true;
    constructor(private readonly orders: Pick<WbOrderService, 'getSales'>) {}
    async readPage(cursor: string) {
        const rows = await this.orders.getSales(cursor);
        if (rows === '' || (Array.isArray(rows) && !rows.length)) return { operations: [], next: null };
        if (!Array.isArray(rows)) throw new Error('Не удалось прочитать продажи и возвраты ВБ');
        const operations: LossOperation[] = [];
        for (let i = 0; i < rows.length; i++) {
            operations.push(normalizeWbLoss(rows[i]));
            if (i % 500 === 0) await jobCheckpoint();
        }
        const next = rows[rows.length - 1]?.lastChangeDate;
        if (typeof next !== 'string' || !next || lossDate(next) < lossDate(cursor))
            throw new Error('Некорректный курсор ВБ');
        return { operations, next };
    }
}
/** Совместимость публичного помощника первого этапа, без копии расчёта. */
export class WbLossAccumulator extends MarketplaceLossAccumulator {
    constructor(period: LossPeriod) {
        super(period, 'WB');
    }
    addSale(raw: unknown) {
        this.addOperation(normalizeWbLoss(raw));
    }
}
