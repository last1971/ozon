import { GoodModule } from '../good/good.module';
import { EnrichWithPricingCommand } from './price-lever/sweep/enrich-with-pricing.command';
import { Module, forwardRef } from '@nestjs/common';
import { PriceModule } from '../price/price.module';
import { ProductModule } from '../product/product.module';
import { JobModule } from '../job/job.module';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';
import { OzonSellerActionsApi } from './seller-actions.api';
import { PromoPriceApplier } from './price-lever/promo-price.applier';
import { PromoPriceService } from './price-lever/promo-price.service';
import { ApplySweepCommand } from './price-lever/sweep/apply-sweep.command';
import { BuildSweepReportCommand } from './price-lever/sweep/build-sweep-report.command';
import { CollectSweepCommand } from './price-lever/sweep/collect-sweep.command';
import { PlanSweepCommand } from './price-lever/sweep/plan-sweep.command';
import { PromoSweepService } from './price-lever/sweep/promo-sweep.service';
import { NotifySweepCommand } from './price-lever/sweep/notify-sweep.command';

@Module({
    imports: [OzonApiModule, ProductModule, forwardRef(() => PriceModule), GoodModule, JobModule],
    providers: [
        OzonPromosApi,
        OzonSellerActionsApi,
        PromosService,
        PromoPriceService,
        PromoPriceApplier,
        CollectSweepCommand,
        EnrichWithPricingCommand,
        PlanSweepCommand,
        ApplySweepCommand,
        BuildSweepReportCommand,
        NotifySweepCommand,
        PromoSweepService,
    ],
    controllers: [PromosController],
    exports: [PromosService, OzonSellerActionsApi, PromoSweepService],
})
export class PromosModule {}
