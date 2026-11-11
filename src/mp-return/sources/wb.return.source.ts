import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WbCardService } from '../../wb.card/wb.card.service';
import { WbCardDto } from '../../wb.card/dto/wb.card.dto';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { ReturnScan } from '../../helpers/return-scan.parser';
import { ReturnLineDto } from '../dto/return-line.dto';
import { IReturnSource } from './i.return.source';
import { candidatePostings, resolveCandidates, ReturnCandidate } from '../return-candidate';
import { inTransaction } from '../../helpers/transaction';
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

    async listReceived(from: Date, to: Date): Promise<ReturnCandidate[]> {
        if (!this.enabled()) return [];
        const rows = (await this.report.rows()).filter((r) => {
            const at = wbReturnCompletedAt(r)?.toJSDate();
            return at && at >= from && at < to;
        });
        return this.toCandidates(rows);
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

    /** Отчёт сначала отбирается по журналу приёма; поиск счетов выполняет общий список. */
    private toCandidates(rows: WbGoodsReturnRow[]): ReturnCandidate[] {
        return rows.map((row) => ({
            ...toReturnLine(row, this.cards.getWbCardByNmId(row.nmId), String(row.orderId), null),
            postingCandidates: [
                { posting: String(row.orderId), schema: 'FBS' },
                ...(row.srid ? [{ posting: row.srid, schema: 'FBO' }] : []),
            ],
        }));
    }

    /** Скан и приём по-прежнему получают разрешённые номера; одно чтение на всю посылку. */
    private async toLines(rows: WbGoodsReturnRow[]): Promise<ReturnLineDto[]> {
        const candidates = this.toCandidates(rows);
        if (!candidates.length) return [];
        return inTransaction(
            () => this.invoiceService.getReadTransaction(),
            async (t) =>
                resolveCandidates(
                    candidates,
                    await this.invoiceService.findByPostings(candidatePostings(candidates), t),
                ),
        );
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
