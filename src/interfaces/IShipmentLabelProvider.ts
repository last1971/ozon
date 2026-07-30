import { InvoiceDto } from '../invoice/dto/invoice.dto';

/**
 * Провайдер этикетки отправления маркетплейса. Общий код (контроллер/оркестратор)
 * зовёт только через этот интерфейс — никаких if(ozon). WB реализует тем же контрактом
 * через getOrdersStickers. getShipmentBarcode добавляется на этапе сверки IGK==ШК.
 */
export interface IShipmentLabelProvider {
    /** PDF этикетки отправления (стр.1 — ШК отправления, товарный ярлык уже отрезан). */
    getShipmentLabel(invoice: InvoiceDto): Promise<Buffer>;
}

export function isShipmentLabelProvider(service: unknown): service is IShipmentLabelProvider {
    return typeof (service as IShipmentLabelProvider)?.getShipmentLabel === 'function';
}
