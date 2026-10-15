import { Injectable, Logger } from '@nestjs/common';
import { MpEventRowDto, MpEventService } from '../../mp-event/mp-event.service';
import { PostingService } from '../../posting/posting.service';
import { ReturnScan } from '../../helpers/return-scan.parser';
import { ReturnLineDto } from '../dto/return-line.dto';
import { IReturnSource } from './i.return.source';

/** Состояние возврата Ozon «получен продавцом» — его и показывает список. */
const RECEIVED_BY_SELLER = 'ReceivedBySeller';

/**
 * Возвраты Ozon для экрана приёма.
 *
 * Основной источник — журнал MP_EVENT: крон возвратов раз в 5 минут кладёт туда запись
 * Ozon целиком (PAYLOAD), включая штрихкод возвратной этикетки `logistic.barcode`.
 * Номер отправления, которого в журнале ещё нет (посылка приехала раньше отметки), —
 * живым запросом `/v1/returns/list` по `posting_numbers`. Живой результат в журнал НЕ пишем:
 * запись двигает MAX(LAST_SEEN) и сужает окно крона. Штрихкод живьём не ищем — фильтра
 * по нему у нас нет; не нашёлся в журнале — «повторите через 5 минут».
 */
@Injectable()
export class OzonReturnSource implements IReturnSource {
    readonly service = 'OZON' as const;
    private readonly logger = new Logger(OzonReturnSource.name);

    constructor(
        private readonly mpEvent: MpEventService,
        private readonly postingService: PostingService,
    ) {}

    async listReceived(from: Date, to: Date): Promise<ReturnLineDto[]> {
        const rows = await this.mpEvent.listInState('OZON', 'RETURN', RECEIVED_BY_SELLER, from, to);
        return this.latestPerReturn(rows);
    }

    async find(scan: ReturnScan): Promise<ReturnLineDto[]> {
        const by =
            scan.kind === 'barcode'
                ? { payloadContains: scan.value }
                : scan.kind === 'posting'
                  ? { posting: scan.value }
                  : scan.kind === 'order'
                    ? { payloadContains: `"order_number":"${scan.value}"` }
                    : { extId: scan.value };
        const rows = await this.mpEvent.findRows('OZON', 'RETURN', by);
        if (rows.length) return this.latestPerReturn(rows);
        if (scan.kind !== 'posting') return [];

        const live = await this.postingService.listReturnsByPostings([scan.value]);
        this.logger.log(`Возврат ${scan.value}: в журнале нет, живьём у Ozon записей ${live.length}`);
        return live.map((r) => toReturnLine(r, null));
    }

    /** По одной строке на возврат — последнее увиденное состояние (строки уже отсортированы свежими вперёд). */
    private latestPerReturn(rows: MpEventRowDto[]): ReturnLineDto[] {
        const seen = new Set<string>();
        const result: ReturnLineDto[] = [];
        for (const row of rows) {
            if (seen.has(row.extId) || !row.payload) continue;
            seen.add(row.extId);
            result.push(toReturnLine(row.payload, row.state));
        }
        return result;
    }
}

/** Запись Ozon `/v1/returns/list` → общая строка возврата. */
export function toReturnLine(p: any, state: string | null): ReturnLineDto {
    const sysName = p?.visual?.status?.sys_name ?? state;
    return {
        service: 'OZON',
        extId: String(p?.id),
        posting: String(p?.posting_number ?? ''),
        offerId: String(p?.product?.offer_id ?? ''),
        productName: p?.product?.name ?? null,
        units: Number(p?.product?.quantity) > 0 ? Number(p.product.quantity) : 1,
        reason: p?.return_reason_name ?? null,
        isBuyout: p?.type === 'ClientReturn',
        isOpened: Boolean(p?.additional_info?.is_opened),
        receivedAt: sysName === RECEIVED_BY_SELLER ? (p?.visual?.change_moment ?? null) : null,
        barcode: p?.logistic?.barcode ?? null,
        schema: p?.schema ?? null,
        stateName: p?.visual?.status?.display_name ?? null,
    };
}
