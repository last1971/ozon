import { Module } from '@nestjs/common';
import { JobModule } from '../job/job.module';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { ProductModule } from '../product/product.module';
import { OzonPriceWriter } from './price-lever/ozon-price-writer';
import { PromoPriceService } from './price-lever/promo-price.service';
import { ApplySweepCommand } from './price-lever/sweep/apply-sweep.command';
import { BuildSweepReportCommand } from './price-lever/sweep/build-sweep-report.command';
import { CollectSweepCommand } from './price-lever/sweep/collect-sweep.command';
import { NotifySweepCommand } from './price-lever/sweep/notify-sweep.command';
import { PromoSweepService } from './price-lever/sweep/promo-sweep.service';
import { OZON_PRICE_TRANSITIONS, OZON_PROMO_STATE_READER } from './price-lever/transition.tokens';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';
import { OzonSellerActionsApi } from './seller-actions.api';

@Module({
    imports: [OzonApiModule, ProductModule, JobModule],
    providers: [
        OzonPromosApi,
        OzonSellerActionsApi,
        PromosService,
        PromoPriceService,
        { provide: OZON_PROMO_STATE_READER, useExisting: PromoPriceService },
        { provide: OZON_PRICE_TRANSITIONS, useExisting: OzonPriceWriter },
        OzonPriceWriter,
        CollectSweepCommand,
        ApplySweepCommand,
        BuildSweepReportCommand,
        NotifySweepCommand,
        PromoSweepService,
    ],
    controllers: [PromosController],
    exports: [OzonPriceWriter, PromosService, OzonSellerActionsApi, PromoSweepService, PromoPriceService],
})
export class PromosModule {}
