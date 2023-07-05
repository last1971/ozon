import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { OrderController } from './order.controller';
import { PostingModule } from '../posting/posting.module';

@Module({
    imports: [ProductModule, PostingModule, InvoiceModule],
    providers: [OrderService],
    controllers: [OrderController],
})
export class OrderModule {}
