import { BadGatewayException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { WbApiService } from './wb.api.service';
import { RateLimit } from '../helpers/decorators/rate-limit.decorator';
import { ReturnHistoryCache } from '../mp-return/sources/return-history.cache';

/** Отчёт ВБ «Возвраты и перемещения»: одна строка — одна штука. */
const REPORT_URL = 'https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-return';
/** ВБ отдаёт не больше 31 дня за запрос и режет период по дате СОЗДАНИЯ возврата (orderDt), не по дате забора. */
const CHUNK_DAYS = 31;
/** Сколько отрезков от сегодня держим: забирают через 3–10 дней после заказа (19.10.2026), запас — три месяца. */
const HISTORY_CHUNKS = 3;
/** Статус «забрали с ПВЗ» — его и показывает список приёма. */
export const WB_RETURN_ISSUED = 'Выдано';
/** Даты отчёта без пояса — московские (`2026-10-09T09:37:11`). */
export const WB_ZONE = 'Europe/Moscow';

export interface WbGoodsReturnRow {
    shkId: number;
    stickerId: string | number | null;
    orderId: number;
    srid: string;
    nmId: number;
    status: string;
    returnType: string | null;
    reason: string | null;
    /** Дата создания возврата у ВБ (по ней режется период запроса). */
    orderDt?: string | null;
    /** Приехал в ПВЗ / пункт выдачи продавцу. */
    readyToReturnDt?: string | null;
    completedDt: string | null;
}

/**
 * Отчёт возвратов ВБ целиком за HISTORY_CHUNKS отрезков, в памяти 5 минут.
 * ЕДИНСТВЕННЫЙ читатель отчёта: экран приёма (список и скан) и возвраты ВБ для
 * конвейера (listReturns) берут строки отсюда — один запрос в минуту на кабинет.
 */
@Injectable()
export class WbGoodsReturnReportService {
    private readonly history = new ReturnHistoryCache(() => this.readHistory());

    constructor(private readonly api: WbApiService) {}

    rows(): Promise<WbGoodsReturnRow[]> {
        return this.history.rows();
    }

    /** Строки под скан; промах — перечитать историю: посылка могла появиться после чтения. */
    find(match: (rows: WbGoodsReturnRow[]) => WbGoodsReturnRow[]): Promise<WbGoodsReturnRow[]> {
        return this.history.find(match);
    }

    private async readHistory(): Promise<WbGoodsReturnRow[]> {
        const byShk = new Map<number, WbGoodsReturnRow>();
        let to = DateTime.now().setZone(WB_ZONE).startOf('day');
        for (let i = 0; i < HISTORY_CHUNKS; i++) {
            const from = to.minus({ days: CHUNK_DAYS - 1 });
            for (const row of await this.readChunk(from.toISODate(), to.toISODate())) byShk.set(row.shkId, row);
            to = from.minus({ days: 1 });
        }
        return [...byShk.values()];
    }

    @RateLimit(1000)
    private async readChunk(dateFrom: string, dateTo: string): Promise<WbGoodsReturnRow[]> {
        // WbApiService при ошибке не бросает, а отдаёт { status: 'NotOk' } — «не прочитали» ≠ «возвратов нет».
        const res = await this.api.method(REPORT_URL, 'get', { dateFrom, dateTo }, true);
        if (!Array.isArray(res?.report)) {
            throw new BadGatewayException(`ВБ: отчёт возвратов не прочитан (${res?.error?.status ?? 'нет ответа'})`);
        }
        return res.report;
    }
}

/** Когда возврат выдан нам (только строки «Выдано»). */
export function wbReturnCompletedAt(r: WbGoodsReturnRow): DateTime | null {
    if (r.status !== WB_RETURN_ISSUED || !r.completedDt) return null;
    const at = DateTime.fromISO(r.completedDt, { zone: WB_ZONE });
    return at.isValid ? at : null;
}
