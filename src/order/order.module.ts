import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { OrderController } from './order.controller';
import { PostingModule } from '../posting/posting.module';
import { YandexOrderModule } from '../yandex.order/yandex.order.module';
import { PostingFboModule } from '../posting.fbo/posting.fbo.module';
import { WbOrderModule } from '../wb.order/wb.order.module';

@Module({
    imports: [ProductModule, PostingModule, InvoiceModule, YandexOrderModule, PostingFboModule, WbOrderModule],
    providers: [OrderService],
    controllers: [OrderController],
})
export class OrderModule {}
