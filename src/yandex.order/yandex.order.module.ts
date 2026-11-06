import { Module } from '@nestjs/common';
import { YandexOrderService } from './yandex.order.service';
import { YandexApiModule } from '../yandex.api/yandex.api.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { JobModule } from '../job/job.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { MpDecisionModule } from '../mp-decision/mp-decision.module';
import { MarketplaceLossModule } from '../marketplace-loss/marketplace-loss.module';
import { YandexLossService } from './returns/yandex-loss.service';
import { LoadYandexLossSalesCommand } from './returns/load-yandex-loss-sales.command';
import { LoadYandexWriteOffsCommand } from './returns/load-yandex-write-offs.command';
import { CalculateYandexLossReportCommand } from './returns/calculate-yandex-loss-report.command';

@Module({
    imports: [YandexApiModule, InvoiceModule, JobModule, MpEventModule, MpDecisionModule, MarketplaceLossModule],
    providers: [
        YandexOrderService,
        YandexLossService,
        LoadYandexLossSalesCommand,
        LoadYandexWriteOffsCommand,
        CalculateYandexLossReportCommand,
    ],
    exports: [YandexOrderService, YandexLossService],
})
export class YandexOrderModule {}
