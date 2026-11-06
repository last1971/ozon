import { ILossHistorySource, LossHistoryPage } from '../marketplace-loss/loss.contracts';
import { LossPeriod } from '../helpers/price/marketplace.loss.stats';
import { calculateOzonReturnPerc } from '../helpers/price/ozon.return.perc';
import { OzonReturnPreviewService } from './ozon.return.preview.service';
import { jobCheckpoint } from '../job/job.checkpoint';

/** Читает существующий отчёт начислений. Не загружает историю повторно и не выбирает тариф/процент категории. */
export class OzonLossHistorySource implements ILossHistorySource {
    readonly service = 'OZON';
    readonly preliminary = false;
    constructor(
        private readonly preview: Pick<OzonReturnPreviewService, 'preview'>,
        private readonly context: { period: LossPeriod; skuToOffer: ReadonlyMap<string, string>; stopChain?: boolean },
    ) {}
    async readPage(cursor: string): Promise<LossHistoryPage> {
        const { period, skuToOffer } = this.context;
        if (cursor !== period.from) throw new Error('Некорректный курсор итогов Ozon');
        const report = await this.preview.preview(period.from, period.to, skuToOffer);
        if (report.issues.length || report.rows.some((r) => r.returnPerc === null))
            throw new Error('Есть неоднозначные данные возвратов Ozon; прежняя статистика сохранена');
        const counts: LossHistoryPage['counts'] = [];
        const seen = new Set<string>();
        for (const row of report.rows) {
            if (seen.has(row.offerId)) throw new Error('Повтор артикула в статистике Ozon');
            seen.add(row.offerId);
            if (row.returnPerc > 1 || row.returnPerc !== calculateOzonReturnPerc(row))
                throw new Error('Некорректная доля возвратов Ozon');
            counts.push({ offerId: row.offerId, soldUnits: row.soldUnits, returnedUnits: row.paidReturnUnits });
            if (counts.length % 500 === 0) await jobCheckpoint(this.context);
        }
        return { operations: [], counts, next: null };
    }
}
