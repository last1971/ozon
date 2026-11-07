import { LossScheduleService } from './loss-schedule.service';
import { LossPriceUpdateModule } from './prices/loss-price-update.module';
import { JobModule } from '../job/job.module';
import { Module } from '@nestjs/common';
import { MarketplaceLossModule } from './marketplace-loss.module';
import { Trade2006AccrualModule } from '../trade2006.accrual/trade2006.accrual.module';
import { OzonReturnService } from '../trade2006.accrual/ozon.return.service';
import { WbOrderModule } from '../wb.order/wb.order.module';
import { WbLossService } from '../wb.order/returns/wb-loss.service';
import { YandexOrderModule } from '../yandex.order/yandex.order.module';
import { YandexLossService } from '../yandex.order/returns/yandex-loss.service';
import { PriceModule } from '../price/price.module';
import { ProductModule } from '../product/product.module';
import { GoodModule } from '../good/good.module';
import { LOSS_RECALCULATORS, LossMarketsService } from './loss-markets.service';
import { LossReportService } from './loss-report.service';
import { LossReportController } from './loss-report.controller';

/** Внешний API отдельно от ядра хранения: адаптеры площадок сами используют ядро, цикла импортов нет. */
@Module({
    imports: [
        MarketplaceLossModule,
        LossPriceUpdateModule,
        JobModule,
        Trade2006AccrualModule,
        WbOrderModule,
        YandexOrderModule,
        PriceModule,
        ProductModule,
        GoodModule,
    ],
    providers: [
        LossMarketsService,
        LossScheduleService,
        LossReportService,
        {
            provide: LOSS_RECALCULATORS,
            inject: [OzonReturnService, WbLossService, YandexLossService],
            useFactory: (ozon: OzonReturnService, wb: WbLossService, yandex: YandexLossService) => ({
                OZON: ozon,
                WB: wb,
                YANDEX: yandex,
            }),
        },
    ],
    controllers: [LossReportController],
})
export class MarketplaceLossApiModule {}
