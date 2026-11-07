import { IJobContext } from '../../interfaces/i.job.context';
import { WbTransactionDto } from '../dto/wb.transaction.dto';

export const WB_FINANCIAL_REPORT_URL = 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed';
export interface WbFinancialContext extends IJobContext {
    from: Date | string;
    to: Date | string;
    cursor: number;
    reportPeriod?: 'weekly' | 'daily';
    dateFrom?: string;
    dateTo?: string;
    raw: Record<string, unknown>[];
    rows: WbTransactionDto[];
}
