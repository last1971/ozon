import { Module } from '@nestjs/common';
import { YandexOrderService } from './yandex.order.service';
import { YandexApiModule } from '../yandex.api/yandex.api.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
    imports: [YandexApiModule, InvoiceModule],
    providers: [YandexOrderService],
    exports: [YandexOrderService],
})
export class YandexOrderModule {}
