import { Inject, Injectable } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { IReturnStock, RETURN_STOCK, ReturnInvoiceLine } from '../interfaces/i.return.stock';
import { MpReturnAcceptStore, ReturnAcceptRecord } from '../mp-event/mp-return-accept.store';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { isDonorMark } from '../helpers/order.cancellation.constants';
import { ReturnLineDto } from './dto/return-line.dto';
import { ReturnAcceptViewDto, ReturnCardDto, ReturnInvoiceViewDto } from './dto/return-card.dto';
import { assessReturnLine } from './assess-return-line';

/**
 * Собирает карточку строки возврата: счёт по номеру отправления, строку счёта под товар
 * с учётом фасовки, коды на строке, запись о приёме и оценку. Одна сборка на экран и на
 * приём (команда LoadReturnCard) — в транзакции приёма она даёт свежий снимок.
 */
@Injectable()
export class ReturnCardBuilder {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        @Inject(RETURN_STOCK) private readonly stock: IReturnStock,
        private readonly acceptStore: MpReturnAcceptStore,
    ) {}

    async build(
        line: ReturnLineDto,
        t: FirebirdTransaction,
        accepted?: ReturnAcceptRecord | null,
    ): Promise<ReturnCardDto> {
        const record = accepted === undefined ? await this.acceptStore.find(line.service, line.extId, t) : accepted;
        const coeff = line.offerId ? goodQuantityCoeff({ offer_id: line.offerId }) : 1;
        const match = line.posting ? await this.invoiceService.findByPosting(line.posting, t) : null;

        let invoice: ReturnInvoiceViewDto | null = null;
        let invoiceLine: ReturnInvoiceLine | null = null;
        if (match) {
            const inv = match.invoice;
            invoice = {
                scode: inv.id,
                number: inv.number ?? null,
                date: inv.date ? new Date(inv.date as any).toISOString() : null,
                status: inv.status,
                prim: inv.remark ?? null,
                mark: match.mark ?? '',
                isDonor: isDonorMark(match.mark),
            };
            invoiceLine = pickInvoiceLine(await this.stock.getLines(inv.id, t), line.offerId, coeff);
        }
        const codes = invoiceLine ? await this.stock.getLineCodes(invoiceLine.realpricecode, t) : [];
        const pieces = invoiceLine?.pieces ?? coeff;
        const quan = line.units * pieces;
        const marksRequired = codes.length > 0;
        const acceptedView = record ? toAcceptView(record) : null;
        const assessment = assessReturnLine({
            line,
            invoice,
            invoiceLine,
            codes,
            quan,
            marksRequired,
            accepted: acceptedView,
        });
        return {
            line,
            invoice,
            invoiceLine,
            codes,
            pieces,
            quan,
            marksRequired,
            accepted: acceptedView,
            ...assessment,
        };
    }
}

/**
 * Строка счёта под возвращённый товар. Один товар может стоять в счёте двумя строками разной
 * фасовки (552601 и 552601-3) — сначала ищем строку с той же фасовкой, что в артикуле.
 */
export function pickInvoiceLine(lines: ReturnInvoiceLine[], offerId: string, coeff: number): ReturnInvoiceLine | null {
    if (!offerId) return null;
    const gc = goodCode({ offer_id: offerId });
    const same = lines.filter((l) => l.goodscode === gc);
    if (same.length <= 1) return same[0] ?? null;
    return (
        same.find((l) => l.pieces === coeff && l.picked > 0) ??
        same.find((l) => l.pieces === coeff) ??
        same.find((l) => l.pieces === null && l.picked > 0) ??
        same[0]
    );
}

export function toAcceptView(r: ReturnAcceptRecord): ReturnAcceptViewDto {
    return {
        decision: r.decision,
        username: r.username,
        createdAt: r.createdAt.toISOString(),
        kis: r.kis,
        comment: r.comment,
        spisCode: r.spisCode,
        spisAt: r.spisAt ? r.spisAt.toISOString() : null,
    };
}
