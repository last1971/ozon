import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { WbApiService } from '../../wb.api/wb.api.service';
import { WbCardService } from '../../wb.card/wb.card.service';
import { WbCardDto } from '../../wb.card/dto/wb.card.dto';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { RateLimit } from '../../helpers/decorators/rate-limit.decorator';
import { ReturnScan } from '../../helpers/return-scan.parser';
import { ReturnLineDto } from '../dto/return-line.dto';
import { IReturnSource } from './i.return.source';
import { ReturnHistoryCache } from './return-history.cache';

/** Отчёт ВБ «Возвраты и перемещения»: одна строка — одна штука. */
const REPORT_URL = 'https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-return';
/** ВБ отдаёт не больше 31 дня за запрос и режет период по дате заказа, не по дате забора. */
const CHUNK_DAYS = 31;
/** Сколько отрезков от сегодня держим: забирают через 3–10 дней после заказа (19.10.2026), запас — три месяца. */
const HISTORY_CHUNKS = 3;
/** Статус «забрали с ПВЗ» — его и показывает список. */
const ISSUED = 'Выдано';
/** Даты отчёта без пояса — московские (`2026-10-09T09:37:11`). */
const WB_ZONE = 'Europe/Moscow';

export interface WbGoodsReturnRow {
    shkId: number;
    stickerId: string | number | null;
    orderId: number;
    srid: string;
    nmId: number;
    status: string;
    returnType: string | null;
    reason: string | null;
    completedDt: string | null;
}

/**
 * Возвраты ВБ для экрана приёма. Отчёт читается целиком за HISTORY_CHUNKS отрезков и держится
 * в памяти 5 минут; список и поиск по скану фильтруют его у нас. Счёт ВБ лежит в S.PRIM под
 * номером сборочного задания (FBS) или под srid (FBO) — источник сам выбирает, под каким.
 */
@Injectable()
export class WbReturnSource implements IReturnSource {
    readonly service = 'WB' as const;
    private readonly history = new ReturnHistoryCache(() => this.readHistory());

    constructor(
        private readonly api: WbApiService,
        private readonly cards: WbCardService,
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly config: ConfigService,
    ) {}

    async listReceived(from: Date, to: Date): Promise<ReturnLineDto[]> {
        if (!this.enabled()) return [];
        const rows = (await this.history.rows()).filter((r) => {
            const at = completedAt(r)?.toJSDate();
            return at && at >= from && at < to;
        });
        return this.toLines(rows);
    }

    async find(scan: ReturnScan): Promise<ReturnLineDto[]> {
        if (!this.enabled()) return [];
        // Стикер (11 цифр) и заказ (10 цифр) парсер отдаёт одним видом — сверяем со всеми номерами.
        const match = (rows: WbGoodsReturnRow[]) =>
            rows.filter((r) =>
                [r.stickerId, r.shkId, r.orderId, r.srid].some((v) => v != null && String(v) === scan.value),
            );
        return this.toLines(await this.history.find(match));
    }

    private enabled(): boolean {
        return this.config.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.WB);
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

    /** По очереди: на строку до двух поисков счёта. */
    private async toLines(rows: WbGoodsReturnRow[]): Promise<ReturnLineDto[]> {
        const lines: ReturnLineDto[] = [];
        for (const row of rows) {
            const { posting, schema } = await this.postingOf(row);
            lines.push(toReturnLine(row, this.cards.getWbCardByNmId(row.nmId), posting, schema));
        }
        return lines;
    }

    private async postingOf(row: WbGoodsReturnRow): Promise<{ posting: string; schema: string | null }> {
        const orderId = String(row.orderId);
        if (await this.invoiceService.findByPosting(orderId, null)) return { posting: orderId, schema: 'FBS' };
        if (row.srid && (await this.invoiceService.findByPosting(row.srid, null)))
            return { posting: row.srid, schema: 'FBO' };
        return { posting: orderId, schema: null };
    }
}

export function completedAt(r: WbGoodsReturnRow): DateTime | null {
    if (r.status !== ISSUED || !r.completedDt) return null;
    const at = DateTime.fromISO(r.completedDt, { zone: WB_ZONE });
    return at.isValid ? at : null;
}

/** Строка отчёта ВБ → общая строка возврата. Тип возврата — в статус: в причине он включил бы «брак» по тексту ВБ. */
export function toReturnLine(
    r: WbGoodsReturnRow,
    card: WbCardDto | null,
    posting: string,
    schema: string | null,
): ReturnLineDto {
    return {
        service: 'WB',
        extId: String(r.shkId),
        posting,
        offerId: card?.vendorCode ?? '',
        productName: card?.title ?? `Карточка ВБ ${r.nmId} не загружена (load-sku-list)`,
        units: 1,
        reason: r.reason || null,
        isBuyout: /после выкупа/i.test(r.returnType ?? ''),
        isOpened: false,
        receivedAt: completedAt(r)?.toISO() ?? null,
        barcode: r.stickerId != null ? String(r.stickerId) : null,
        schema,
        stateName: [r.status, r.returnType].filter(Boolean).join(' — ') || null,
    };
}
