import { SaveLossContext } from '../../marketplace-loss/loss.commands';
import { WbFinancialContext } from '../finance/financial-report.context';
export interface WbLossFinancialContext extends SaveLossContext {
    financialWindows?: WbFinancialContext[];
    financialIssues?: { offerId: string; reason: string }[];
}
