import { IJobContext } from '../../interfaces/i.job.context';
import { PriceUpdateReport } from '../price-update.report';
import { PricingWarning } from '../../helpers/price/pricing-warnings';
export interface BulkPriceRow {
    offer_id: string;
    status: 'accepted' | 'unchanged' | 'skipped' | 'error';
    reason?: string;
}
export interface BulkPriceReport {
    total: number;
    accepted: number;
    unchanged: number;
    skipped: number;
    failed: number;
    rows: BulkPriceRow[];
    warnings: PricingWarning[];
}
export interface BulkPriceSource {
    market: 'ozon' | 'wb';
    page: (cursor: string) => Promise<{ offers: string[]; next?: string }>;
    update: (offers: string[], context?: IJobContext) => Promise<PriceUpdateReport>;
}
export interface BulkPriceContext extends IJobContext {
    source: BulkPriceSource;
    offers: string[];
    rows: BulkPriceRow[];
    warnings: Map<string, PricingWarning>;
    report?: BulkPriceReport;
}
