import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { YandexApiService } from '../../yandex.api/yandex.api.service';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { ReturnScan } from '../../helpers/return-scan.parser';
import { ReturnLineDto } from '../dto/return-line.dto';
import { IReturnSource } from './i.return.source';
import { ReturnHistoryCache } from './return-history.cache';

/**
 * Сколько дней истории держим. Окно Яндекса — по дате ОБНОВЛЕНИЯ возврата (проверено 21.10.2026:
 * невыкуп, созданный 12.06, пришёл в окне с 23.06 — обновлён 24.06). Невыкуп забираем через
 * 1–3 недели после отмены, запас — четыре месяца.
 */
const HISTORY_DAYS = 120;
const PAGE_LIMIT = 100;
/** «Забран магазином» — его и показывает список. */
const PICKED = 'PICKED';

export interface YandexReturnItem {
    shopSku: string | null;
    count: number;
    decisions?: { reasonType?: string | null; comment?: string | null }[];
    tracks?: { trackCode?: string | null }[];
}

export interface YandexReturn {
    id: number;
    orderId: number;
    returnType: 'UNREDEEMED' | 'RETURN' | string;
    shipmentStatus: string | null;
    updateDate: string;
    items: YandexReturnItem[];
}

const RETURN_TYPE: Record<string, string> = { UNREDEEMED: 'Невыкуп', RETURN: 'Возврат' };
const SHIPMENT_STATUS: Record<string, string> = {
    CREATED: 'создан',
    IN_TRANSIT: 'в пути к нам',
    READY_FOR_PICKUP: 'ждёт нас в ПВЗ',
    PICKED: 'забран магазином',
    LOST: 'утерян',
};
const REASON_TYPE: Record<string, string> = {
    BAD_QUALITY: 'брак',
    DAMAGE_DELIVERY: 'повреждён при доставке',
    WRONG_ITEM: 'привезли не тот товар',
    DO_NOT_FIT: 'не подошёл',
    CONTENT_FAIL: 'не соответствует описанию',
    DELIVERY_FAIL: 'проблема доставки',
};

/**
 * Возвраты и невыкупы Яндекс Маркета для экрана приёма: `GET campaigns/{id}/returns`.
 * Поиска по этикетке у Яндекса нет — история читается целиком и фильтруется у нас.
 * Счёт Яндекса лежит в S.PRIM под номером заказа.
 */
@Injectable()
export class YandexReturnSource implements IReturnSource {
    readonly service = 'YANDEX' as const;
    private readonly history = new ReturnHistoryCache(() => this.readHistory());

    constructor(
        private readonly api: YandexApiService,
        private readonly config: ConfigService,
    ) {}

    async listReceived(from: Date, to: Date): Promise<ReturnLineDto[]> {
        if (!this.enabled()) return [];
        return (await this.history.rows()).flatMap(toReturnLines).filter((l) => {
            const at = l.receivedAt ? new Date(l.receivedAt) : null;
            return at && at >= from && at < to;
        });
    }

    async find(scan: ReturnScan): Promise<ReturnLineDto[]> {
        if (!this.enabled()) return [];
        const value = scan.value.toUpperCase();
        const lines = (await this.history.find((rows) => rows.filter((r) => scanKeys(r).has(value)))).flatMap(
            toReturnLines,
        );
        // id строки многотоварного возврата — ровно та строка (так приходит повторный поиск при приёме).
        const exact = lines.filter((l) => l.extId === scan.value);
        return exact.length ? exact : lines;
    }

    private enabled(): boolean {
        return this.config.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.YANDEX);
    }

    private async readHistory(): Promise<YandexReturn[]> {
        const campaignId = await this.api.campaignId();
        const params = {
            fromDate: DateTime.now().minus({ days: HISTORY_DAYS }).toISODate(),
            // Завтра — чтобы не потерять обновлённые сегодня (проверено: будущая дата принимается).
            toDate: DateTime.now().plus({ days: 1 }).toISODate(),
            limit: PAGE_LIMIT,
        };
        const rows: YandexReturn[] = [];
        let pageToken: string | undefined;
        do {
            // YandexApiService при ошибке не бросает — «не прочитали» ≠ «возвратов нет».
            const res = await this.api.method(`campaigns/${campaignId}/returns`, 'get', { ...params, pageToken });
            if (res?.status !== 'OK' || !Array.isArray(res?.result?.returns)) {
                const why = res?.error?.message ?? res?.error?.service_message ?? 'нет ответа';
                throw new BadGatewayException(`Яндекс: возвраты не прочитаны (${why})`);
            }
            rows.push(...res.result.returns);
            pageToken = res.result.paging?.nextPageToken;
        } while (pageToken);
        return rows;
    }
}

/** Чем кладовщик может найти возврат: номер заказа, id возврата, id строки, трек коробки или этикетки. */
function scanKeys(r: YandexReturn): Set<string> {
    const keys = [String(r.id), String(r.orderId), ...toReturnLines(r).map((l) => l.extId)];
    for (const item of r.items) for (const t of item.tracks ?? []) if (t.trackCode) keys.push(t.trackCode);
    return new Set(keys.map((k) => k.toUpperCase()));
}

/**
 * Возврат Яндекса → строки возврата, по одной на товар. Время получения — время последнего
 * обновления забранного возврата: отдельного «забран в» Яндекс не отдаёт.
 */
export function toReturnLines(r: YandexReturn): ReturnLineDto[] {
    const picked = r.shipmentStatus === PICKED;
    return r.items.map((item) => ({
        service: 'YANDEX',
        extId: r.items.length > 1 ? `${r.id}-${item.shopSku}` : String(r.id),
        posting: String(r.orderId),
        offerId: item.shopSku ?? '',
        productName: null,
        units: item.count > 0 ? item.count : 1,
        reason: reasonOf(item),
        isBuyout: r.returnType === 'RETURN',
        isOpened: false,
        receivedAt: picked ? DateTime.fromISO(r.updateDate).toISO() : null,
        barcode: item.tracks?.find((t) => t.trackCode)?.trackCode ?? null,
        schema: 'FBS',
        stateName: [
            RETURN_TYPE[r.returnType] ?? r.returnType,
            SHIPMENT_STATUS[r.shipmentStatus ?? ''] ?? r.shipmentStatus,
        ]
            .filter(Boolean)
            .join(' — '),
    }));
}

function reasonOf(item: YandexReturnItem): string | null {
    const reasons = (item.decisions ?? [])
        .map((d) => [REASON_TYPE[d.reasonType ?? ''] ?? null, d.comment?.trim() || null].filter(Boolean).join(': '))
        .filter(Boolean);
    return reasons.length ? [...new Set(reasons)].join('; ') : null;
}
