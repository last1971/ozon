import { MpKind } from '../../mp-event/mp-event.service';

export const PROFIT_CHECK_KIND: MpKind = 'PROFIT_CHECK';
export const PROFIT_CHECK_PENDING = 'pending';
/** Событие из создания счёта по заказу маркетплейса (Trade2006InvoiceService.createInvoiceFromPostingDto). */
export const INVOICE_CREATED_EVENT = 'invoice.created';
