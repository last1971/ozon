import { ISupplierDelivery } from './i.supplier.delivery';

/** Доставка Promelec: отдельное правило, текущая согласованная надбавка 0 ₽. */
export class PromelecDeliveryCost implements ISupplierDelivery {
    costRub(_incomingRub: number, _code: string): number { return 0; }
}
