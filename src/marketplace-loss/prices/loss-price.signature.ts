import { StoredLossRow } from '../loss.contracts';
import { MarketplaceLossRow } from '../../helpers/price/marketplace.loss.stats';
import { lossExpensesPerSale } from '../loss-expenses';

/** Только входы цены. Смена даты/окна или пропорциональный рост количеств не создают лишнюю отправку. */
export function lossPriceSignature(service: string, row: StoredLossRow | MarketplaceLossRow | undefined): string {
    if (!row) return 'missing';
    const perSale = lossExpensesPerSale(row);
    return JSON.stringify([
        row.returnRate,
        service === 'OZON' ? (row.appliedReturnRate ?? null) : null,
        row.defectRate,
        perSale
            ? [
                  perSale.paidReturnDelivery === undefined ? 'tariff' : perSale.paidReturnDelivery,
                  perSale.cancellationDelivery,
                  perSale.sellerReturnDelivery,
                  perSale.confirmedDefectCompensation,
              ]
            : 'no-expenses',
    ]);
}
