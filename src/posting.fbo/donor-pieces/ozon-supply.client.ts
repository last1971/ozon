import { Injectable, Logger } from '@nestjs/common';
import { OzonApiService } from '../../ozon.api/ozon.api.service';
import { SupplyItem, SupplyLookup } from './donor-pieces.types';

/**
 * Все статусы заявки на поставку (v3). Фильтр обязателен и непустой; неизвестное название Озон
 * молча выбрасывает — список сверен запросом 16.10.2026, каждое из 11 принимается.
 */
const ALL_STATES = [
    'DATA_FILLING',
    'READY_TO_SUPPLY',
    'ACCEPTED_AT_SUPPLY_WAREHOUSE',
    'IN_TRANSIT',
    'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
    'REPORTS_CONFIRMATION_AWAITING',
    'REPORT_REJECTED',
    'COMPLETED',
    'REJECTED_AT_SUPPLY_WAREHOUSE',
    'CANCELLED',
    'OVERDUE',
];

const RETRIES = 3;
const RETRY_PAUSE_MS = 1500;

/**
 * Состав поставки FBO по её номеру (тот, что пишут в примечание счёта FORFBO):
 * поиск заявки по номеру → заявка → состав (артикул с суффиксом фасовки + упаковок).
 * Кабинет — тот, что у узла в Vault: поставка опта в кабинете магазина не находится, и это верно.
 */
@Injectable()
export class OzonSupplyClient {
    private readonly logger = new Logger(OzonSupplyClient.name);

    constructor(private readonly api: OzonApiService) {}

    async lookup(supplyNumber: string): Promise<SupplyLookup> {
        try {
            const list = await this.call('/v3/supply-order/list', {
                filter: { states: ALL_STATES, order_number_search: supplyNumber },
                limit: 100,
                sort_by: 'ORDER_CREATION',
                sort_dir: 'DESC',
            });
            const orderIds: string[] = (list?.order_ids ?? []).map(String);
            if (!orderIds.length) return { kind: 'not_found' };

            const got = await this.call('/v3/supply-order/get', { order_ids: orderIds });
            // Поиск по номеру — подстрочный: берём только заявку, где номер совпал целиком.
            const order = (got?.orders ?? []).find(
                (o: any) =>
                    String(o.order_number) === supplyNumber ||
                    (o.supplies ?? []).some((s: any) => String(s.supply_id) === supplyNumber),
            );
            if (!order) return { kind: 'not_found' };

            const bundleIds: string[] = (order.supplies ?? []).map((s: any) => s.bundle_id).filter(Boolean);
            const items: SupplyItem[] = [];
            for (const bundleId of bundleIds) items.push(...(await this.bundleItems(bundleId)));
            return { kind: 'found', items };
        } catch (e) {
            this.logger.warn(`поставка ${supplyNumber}: ${e.message}`);
            return { kind: 'error', message: e.message };
        }
    }

    private async bundleItems(bundleId: string): Promise<SupplyItem[]> {
        const items: SupplyItem[] = [];
        let lastId: string | undefined;
        for (;;) {
            const page = await this.call('/v1/supply-order/bundle', {
                bundle_ids: [bundleId],
                limit: 100,
                ...(lastId ? { last_id: lastId } : {}),
            });
            for (const it of page?.items ?? []) {
                items.push({ offerId: String(it.offer_id), units: Number(it.quantity) || 0 });
            }
            if (!page?.has_next || !page?.last_id || page.last_id === lastId) return items;
            lastId = String(page.last_id);
        }
    }

    /** Запрос с повтором на 429: ручки поставок у Озона с лимитом, проход идёт по сотне номеров подряд. */
    private async call(endpoint: string, body: unknown): Promise<any> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.api.rawFetch(endpoint, body);
            } catch (e) {
                if (attempt >= RETRIES || !/\b429\b/.test(e.message)) throw e;
                await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS * attempt));
            }
        }
    }
}
