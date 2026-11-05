import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { MpEventRowDto, MpEventService } from '../mp-event/mp-event.service';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { buildOzonReturnStats, OzonReturnReport } from '../helpers/price/ozon.return.stats';
import { normalizeOzonRebookings, readOzonSaleLines } from '../helpers/price/ozon.accrual.normalizer';
import { resolveOzonInvoiceQuantity } from '../helpers/price/ozon.invoice.quantity';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';

/** Только предварительный расчёт по уже загруженной истории. Нет API-загрузки, cron и записи результата. */
@Injectable()
export class OzonReturnPreviewService {
    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly accruals: Trade2006AccrualService,
        private readonly events: MpEventService,
        private readonly invoices: Trade2006InvoiceService,
    ) {}

    /** [from, to), даты YYYY-MM-DD. Сопоставление SKU → артикул передаётся из существующего каталога. */
    async preview(from: string, to: string, skuToOffer: ReadonlyMap<string, string>): Promise<OzonReturnReport> {
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
            !DateTime.fromISO(from).isValid ||
            !DateTime.fromISO(to).isValid ||
            from >= to
        ) {
            throw new Error('Нужен непустой период дат YYYY-MM-DD');
        }
        const t = await this.pool.getTransaction(ISOLATION_READ_COMMITTED_READ_ONLY);
        try {
            const raw = await this.accruals.listBodies(from, to, t);
            const postings = new Set(
                readOzonSaleLines(raw)
                    .filter((line) => line.kind === 'refund')
                    .map((line) => line.posting),
            );
            const returns: MpEventRowDto[] = [];
            for (const posting of postings) {
                returns.push(...(await this.events.findRows('OZON', 'RETURN', { posting }, t)));
            }
            const normalized = normalizeOzonRebookings(raw, new Set(returns.map((event) => event.posting)));
            const lines = readOzonSaleLines(normalized.accruals);
            const unknownPostings = new Set(
                lines.filter((line) => line.kind === 'sale' && line.units === null).map((line) => line.posting),
            );
            const resolved = new Map<(typeof lines)[number], number>();
            for (const posting of unknownPostings) {
                const match = await this.invoices.findByPosting(posting, t, true);
                if (!match || match.cancelled) continue;
                const invoiceLines = await this.invoices.getRealpriceLinesByScode(match.invoice.id, t);
                for (const line of lines.filter(
                    (item) => item.posting === posting && item.kind === 'sale' && item.units === null,
                )) {
                    const units = resolveOzonInvoiceQuantity(line, lines, skuToOffer, invoiceLines);
                    if (units !== null) resolved.set(line, units);
                }
            }
            return buildOzonReturnStats(
                lines.map((line) => (resolved.has(line) ? { ...line, units: resolved.get(line) } : line)),
                returns,
                skuToOffer,
                normalized.ambiguousPostings,
            );
        } finally {
            await t.rollback(true);
        }
    }
}
