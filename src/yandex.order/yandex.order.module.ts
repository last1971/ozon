import { Module } from '@nestjs/common';
import { YandexOrderService } from './yandex.order.service';
import { YandexApiModule } from '../yandex.api/yandex.api.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { MpDecisionModule } from '../mp-decision/mp-decision.module';

@Module({
    imports: [YandexApiModule, InvoiceModule, MpEventModule, MpDecisionModule],
    providers: [YandexOrderService],
    exports: [YandexOrderService],
})
export class YandexOrderModule {}
