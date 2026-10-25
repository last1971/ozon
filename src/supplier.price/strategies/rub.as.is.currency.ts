import { ISupplierCurrency } from './i.supplier.currency';

/** Поставщик даёт рубли — берём как есть. Другая валюта у такого поставщика — ошибка строки. */
export class RubAsIsCurrency implements ISupplierCurrency {
    toRub(price: number, currency: string): number {
        if (currency.toUpperCase() !== 'RUB') {
            throw new Error(`поставщик считается в рублях, пришла валюта ${currency}`);
        }
        return price;
    }
}
