import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { OrderModule } from '../order/order.module';
import { PickupController } from './pickup.controller';

@Module({
    imports: [InvoiceModule, OrderModule],
    controllers: [PickupController],
})
export class PickupModule {}
