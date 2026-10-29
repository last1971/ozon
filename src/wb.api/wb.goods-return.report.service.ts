import { BadGatewayException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { WbApiService } from './wb.api.service';
import { RateLimit } from '../helpers/decorators/rate-limit.decorator';
import { ReturnHistoryCache } from '../mp-return/sources/return-history.cache';

/** Отчёт ВБ «Возвраты и перемещения»: одна строка — одна штука. */
const REPORT_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/item-returns';
/** Историю держим 93 дня: новая версия отчёта принимает этот период одним запросом на статус. */
const HISTORY_DAYS = 93;
const PAGE_SIZE = 1000;
const REPORT_STATUSES = ['active', 'archive'] as const;
/** Статус «забрали с ПВЗ» — его и показывает список приёма. */
export const WB_RETURN_ISSUED = 'Выдано';
/** Даты отчёта без пояса — московские; новая ручка возвращает `completedDt` с пробелом вместо `T`. */
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

interface WbGoodsReturnApiRow extends Omit<WbGoodsReturnRow, 'status' | 'reason'> {
    returnStatus: string;
    returnReason?: string | null;
}

/**
 * Отчёт возвратов ВБ за последние 93 дня, в памяти 5 минут.
 * ЕДИНСТВЕННЫЙ читатель отчёта: экран приёма (список и скан) и возвраты ВБ для
 * конвейера (listReturns) берут строки отсюда — выборка и нормализация в одном месте.
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
        const to = DateTime.now().setZone(WB_ZONE).startOf('day');
        const from = to.minus({ days: HISTORY_DAYS - 1 });
        for (const status of REPORT_STATUSES) {
            for (const row of await this.readChunk(from.toISODate(), to.toISODate(), status)) {
                byShk.set(row.shkId, row);
            }
        }
        return [...byShk.values()];
    }

    @RateLimit(1000)
    private async readChunk(
        dateFrom: string,
        dateTo: string,
        status: (typeof REPORT_STATUSES)[number],
    ): Promise<WbGoodsReturnRow[]> {
        const rows: WbGoodsReturnRow[] = [];
        let offset = 0;
        while (true) {
            const res = await this.api.method(
                REPORT_URL,
                'get',
                { dateFrom, dateTo, status, limit: PAGE_SIZE, offset },
                true,
            );
            // WB отвечает 204, когда в выбранном статусе и периоде нет возвратов.
            if (res == null || res === '') return rows;
            if (!Array.isArray(res?.report) || !Number.isInteger(res?.count)) {
                throw new BadGatewayException(
                    `ВБ: отчёт возвратов не прочитан (${res?.error?.status ?? 'нет ответа'})`,
                );
            }

            const page = res.report as WbGoodsReturnApiRow[];
            rows.push(...page.map((row) => this.toRow(row)));
            offset += page.length;
            if (!page.length || offset >= res.count) return rows;
        }
    }

    private toRow(row: WbGoodsReturnApiRow): WbGoodsReturnRow {
        return {
            shkId: row.shkId,
            stickerId: row.stickerId,
            orderId: row.orderId,
            srid: row.srid,
            nmId: row.nmId,
            status: row.returnStatus,
            returnType: row.returnType,
            reason: row.returnReason ?? null,
            orderDt: row.orderDt,
            readyToReturnDt: row.readyToReturnDt,
            completedDt: row.completedDt,
        };
    }
}

/** Когда возврат выдан нам (только строки «Выдано»). */
export function wbReturnCompletedAt(r: WbGoodsReturnRow): DateTime | null {
    if (r.status !== WB_RETURN_ISSUED || !r.completedDt) return null;
    const at = DateTime.fromISO(r.completedDt, { zone: WB_ZONE });
    if (at.isValid) return at;
    const sqlDate = DateTime.fromSQL(r.completedDt, { zone: WB_ZONE });
    return sqlDate.isValid ? sqlDate : null;
}
