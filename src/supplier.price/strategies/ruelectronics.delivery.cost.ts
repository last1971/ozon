import { ISupplierDelivery } from './i.supplier.delivery';

/** Доставка от ruelectronics. Формулы пока нет (как у Компэла) — 0; переписывается здесь, не в общем коде. */
export class RuelectronicsDeliveryCost implements ISupplierDelivery {
    costRub(_incomingRub: number, _code: string): number {
        return 0;
    }
}
