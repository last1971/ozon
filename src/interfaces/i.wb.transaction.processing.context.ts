import { WbTransactionDto } from '../wb.order/dto/wb.transaction.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';

export interface IWbTransactionProcessingContext {
    dateFrom: Date;
    dateTo?: Date;
    stickerId: string;
    sales?: any[];
    srid?: string;
    transactions?: WbTransactionDto[];
    filteredTransactions?: WbTransactionDto[];
    selectedId?: string;
    selectedIdType?: 'assembly_id' | 'srid';
    invoice?: InvoiceDto;
    stopChain?: boolean;
}
