import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { OrderController } from './order.controller';
import { PostingModule } from '../posting/posting.module';
import { YandexOrderModule } from '../yandex.order/yandex.order.module';
import { PostingFboModule } from '../posting.fbo/posting.fbo.module';
import { WbOrderModule } from '../wb.order/wb.order.module';
import { WbCustomerModule } from '../wb.customer/wb.customer.module';
import { Trade2006AccrualModule } from '../trade2006.accrual/trade2006.accrual.module';
import { ProcessedCacheModule } from '../processed-cache/processed-cache.module';

@Module({
    imports: [
        ProductModule,
        PostingModule,
        InvoiceModule,
        YandexOrderModule,
        PostingFboModule,
        WbOrderModule,
        WbCustomerModule,
        ProcessedCacheModule,
        Trade2006AccrualModule,
    ],
    providers: [OrderService],
    controllers: [OrderController],
    exports: [OrderService],
})
export class OrderModule {}
