import { DateTime } from 'luxon';
import { ILossHistorySource, LossCounts, LossHistoryPage } from '../../marketplace-loss/loss.contracts';
import { LossPeriod } from '../../helpers/price/marketplace.loss.stats';
import { YandexOrderDto } from '../dto/yandex.order.dto';
import { jobCheckpoint } from '../../job/job.checkpoint';

/**
 * Источник предварительный (preliminary=true): API Яндекса отдаёт DELIVERED не более чем за ~30 дней,
 * а возвраты не загружаются — returnedUnits всегда 0. Дефект считается по физическим списаниям
 * из MP_RETURN_ACCEPT, которые LoadYandexWriteOffsCommand грузит отдельно и не зависят от этого источника.
 */
export class YandexLossHistorySource implements ILossHistorySource {
    readonly service = 'YANDEX';
    // Предварительный: API ограничен ~30 днями, возвраты не загружаются через этот источник.
    readonly preliminary = true;

    constructor(
        private readonly orders: Pick<{ listOrders(params: Record<string, any>): Promise<YandexOrderDto[]> }, 'listOrders'>,
        private readonly period: LossPeriod,
    ) {}

    async readPage(cursor: string): Promise<LossHistoryPage> {
        if (cursor !== this.period.from) throw new Error('Некорректный курсор Яндекс');
        const counts = new Map<string, LossCounts>();
        const seenOrders = new Set<number | string>();

        const start = DateTime.fromISO(this.period.from, { zone: 'Europe/Moscow' });
        const end = DateTime.fromISO(this.period.to, { zone: 'Europe/Moscow' });
        // API принимает не более 29 дней за запрос. Загружаем окнами, но данные доступны только
        // за ~30 последних дней — остаток периода вернёт пустые страницы. preliminary=true.
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
                if (!Array.isArray(order.items))
                    throw new Error(`Заказ Яндекс ${order.id}: отсутствует массив позиций`);
                if (seenOrders.has(order.id)) continue; // дубль окна — пропускаем
                seenOrders.add(order.id);
                for (const item of order.items) {
                    if (typeof item.offerId !== 'string' || !item.offerId.trim())
                        throw new Error(`Некорректный offerId в заказе Яндекс ${order.id}`);
                    if (!Number.isInteger(item.count) || item.count <= 0)
                        throw new Error(`Некорректное количество в заказе Яндекс ${order.id}`);
                    const key = item.offerId.trim();
                    if (!counts.has(key)) counts.set(key, { offerId: key, soldUnits: 0, returnedUnits: 0 });
                    counts.get(key).soldUnits += item.count;
                }
            }
            windowStart = windowEnd;
        }
        return { operations: [], counts: [...counts.values()], next: null };
    }
}
