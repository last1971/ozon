import { InvoiceDto } from '../invoice/dto/invoice.dto';

/**
 * Провайдер этикетки отправления маркетплейса. Общий код (контроллер/оркестратор)
 * зовёт только через этот интерфейс — никаких if(ozon). WB реализует тем же контрактом
 * через getOrdersStickers. getShipmentBarcode добавляется на этапе сверки IGK==ШК.
 */
export interface IShipmentLabelProvider {
    /** PDF этикетки отправления (стр.1 — ШК отправления, товарный ярлык уже отрезан). */
    getShipmentLabel(invoice: InvoiceDto): Promise<Buffer>;
    /**
     * ШК отправления с этикетки — эталон для сверки IGK==ШК на FINISH_PICKUP.
     * Опционально: у ВБ метода нет → сверка тихо пропускается.
     */
    getShipmentBarcode?(invoice: InvoiceDto): Promise<string>;
}

export function isShipmentLabelProvider(service: unknown): service is IShipmentLabelProvider {
    return typeof (service as IShipmentLabelProvider)?.getShipmentLabel === 'function';
}
