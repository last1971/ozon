import { ISupplierCurrency } from './i.supplier.currency';

/** Курс ЦБ + N% (Компэл: USD, +2%). Рубли проходят без наценки на курс. */
export class CbrPlusPercentCurrency implements ISupplierCurrency {
    constructor(private readonly percent: number) {}

    toRub(price: number, currency: string, rates: Record<string, number>): number {
        const cur = currency.toUpperCase();
        if (cur === 'RUB') return price;
        const rate = rates?.[cur];
        if (!Number.isFinite(rate) || rate <= 0) {
            throw new Error(`нет курса ЦБ для ${cur}`);
        }
        return price * rate * (1 + this.percent / 100);
    }
}
