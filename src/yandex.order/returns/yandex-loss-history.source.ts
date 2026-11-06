import { DateTime } from 'luxon';
import { ILossHistorySource, LossCounts, LossHistoryPage } from '../../marketplace-loss/loss.contracts';
import { LossPeriod } from '../../helpers/price/marketplace.loss.stats';
import { YandexOrderDto } from '../dto/yandex.order.dto';
import { jobCheckpoint } from '../../job/job.checkpoint';

export class YandexLossHistorySource implements ILossHistorySource {
    readonly service = 'YANDEX';
    readonly preliminary = false;

    constructor(
        private readonly orders: Pick<{ listOrders(params: Record<string, any>): Promise<YandexOrderDto[]> }, 'listOrders'>,
        private readonly period: LossPeriod,
    ) {}

    async readPage(cursor: string): Promise<LossHistoryPage> {
        if (cursor !== this.period.from) throw new Error('Некорректный курсор Яндекс');
        const counts = new Map<string, LossCounts>();
        const add = (offerId: string, units: number, kind: 'sold' | 'returned') => {
            if (!counts.has(offerId)) counts.set(offerId, { offerId, soldUnits: 0, returnedUnits: 0 });
            const row = counts.get(offerId);
            if (kind === 'sold') row.soldUnits += units;
            else row.returnedUnits += units;
        };

        const start = DateTime.fromISO(this.period.from, { zone: 'Europe/Moscow' });
        const end = DateTime.fromISO(this.period.to, { zone: 'Europe/Moscow' });
        // Яндекс не принимает интервалы более 29 дней — разбиваем вручную.
        const WINDOW = 29;
        let windowStart = start;
        while (windowStart < end) {
            const windowEnd = windowStart.plus({ days: WINDOW });
            const fromDate = windowStart.toFormat('dd-MM-yyyy');
            const toDate = (windowEnd < end ? windowEnd : end).toFormat('dd-MM-yyyy');
            await jobCheckpoint();
            const batch = await this.orders.listOrders({ status: 'DELIVERED', fromDate, toDate });
            if (!Array.isArray(batch)) throw new Error('Некорректный ответ заказов Яндекс');
            for (const order of batch) {
                for (const item of order.items ?? []) {
                    if (typeof item.offerId !== 'string' || !item.offerId.trim())
                        throw new Error(`Некорректный offerId в заказе Яндекс ${order.id}`);
                    if (!Number.isInteger(item.count) || item.count <= 0)
                        throw new Error(`Некорректное количество в заказе Яндекс ${order.id}`);
                    add(item.offerId.trim(), item.count, 'sold');
                }
            }
            windowStart = windowEnd;
        }
        return { operations: [], counts: [...counts.values()], next: null };
    }
}
