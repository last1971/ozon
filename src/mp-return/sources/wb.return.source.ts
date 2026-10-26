import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WbCardService } from '../../wb.card/wb.card.service';
import { WbCardDto } from '../../wb.card/dto/wb.card.dto';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { ReturnScan } from '../../helpers/return-scan.parser';
import { ReturnLineDto } from '../dto/return-line.dto';
import { IReturnSource } from './i.return.source';
import {
    WbGoodsReturnReportService,
    WbGoodsReturnRow,
    wbReturnCompletedAt,
} from '../../wb.api/wb.goods-return.report.service';

export type { WbGoodsReturnRow } from '../../wb.api/wb.goods-return.report.service';
export { wbReturnCompletedAt as completedAt } from '../../wb.api/wb.goods-return.report.service';

/**
 * Возвраты ВБ для экрана приёма. Отчёт «Возвраты и перемещения» читает общий
 * WbGoodsReturnReportService (кэш 5 минут); список и поиск по скану фильтруют его у нас.
 * Счёт ВБ лежит в S.PRIM под номером сборочного задания (FBS) или под srid (FBO) —
 * источник сам выбирает, под каким.
 */
@Injectable()
export class WbReturnSource implements IReturnSource {
    readonly service = 'WB' as const;

    constructor(
        private readonly report: WbGoodsReturnReportService,
        private readonly cards: WbCardService,
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly config: ConfigService,
    ) {}

    async listReceived(from: Date, to: Date): Promise<ReturnLineDto[]> {
        if (!this.enabled()) return [];
        const rows = (await this.report.rows()).filter((r) => {
            const at = wbReturnCompletedAt(r)?.toJSDate();
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
        return this.toLines(await this.report.find(match));
    }

    private enabled(): boolean {
        return this.config.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.WB);
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
        receivedAt: wbReturnCompletedAt(r)?.toISO() ?? null,
        barcode: r.stickerId != null ? String(r.stickerId) : null,
        schema,
        stateName: [r.status, r.returnType].filter(Boolean).join(' — ') || null,
    };
}
