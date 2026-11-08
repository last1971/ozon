import { SaleLine } from './profit-check.types';

/** Цена входит в ключ: новый найденный результат должен пройти проверку заново. */
export const profitLineKey = (line: SaleLine): string => JSON.stringify([line.offer_id, line.units, line.pricePerUnit]);
