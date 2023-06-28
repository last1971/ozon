import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
    imports: [ProductModule, InvoiceModule],
    providers: [OrderService],
})
export class OrderModule {}
