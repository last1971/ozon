import { ISupplierDelivery } from './i.supplier.delivery';

/** Доставка от Компэла. Формулы пока нет (решение владельца 25.10.2026) — 0; переписывается здесь, не в общем коде. */
export class CompelDeliveryCost implements ISupplierDelivery {
    costRub(_incomingRub: number, _code: string): number {
        return 0;
    }
}
