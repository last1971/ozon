import { ISupplierDelivery } from './i.supplier.delivery';

/** Отдельная стоимость доставки Uniservice пока не задана. */
export class UnisvsDeliveryCost implements ISupplierDelivery {
    costRub(_incomingRub: number, _code: string): number {
        return 0;
    }
}
