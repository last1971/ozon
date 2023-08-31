import { OrdersStatsPaymentDto } from './orders.stats.payment.dto';
import { OrdersStatsCommissionDto } from './orders.stats.commission.dto';

export class OrderStatsDto {
    status: string;
    partnerOrderId: string;
    payments: OrdersStatsPaymentDto[];
    commissions: OrdersStatsCommissionDto[];
}
