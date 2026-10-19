import { Module } from '@nestjs/common';
import { PriceModule } from 'src/price/price.module';
import { ProductModule } from 'src/product/product.module';
import { JobModule } from '../job/job.module';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';
import { OzonSellerActionsApi } from './seller-actions.api';
import { PromoPriceApplier } from './price-lever/promo-price.applier';
import { PromoPriceService } from './price-lever/promo-price.service';
import { ApplyBelowMinCommand } from './price-lever/sweep/apply-below-min.command';
import { BuildSweepReportCommand } from './price-lever/sweep/build-sweep-report.command';
import { CollectBelowMinCommand } from './price-lever/sweep/collect-below-min.command';
import { PlanBelowMinCommand } from './price-lever/sweep/plan-below-min.command';
import { PromoSweepService } from './price-lever/sweep/promo-sweep.service';

@Module({
    imports: [OzonApiModule, ProductModule, PriceModule, JobModule],
    providers: [
        OzonPromosApi,
        OzonSellerActionsApi,
        PromosService,
        PromoPriceService,
        PromoPriceApplier,
        CollectBelowMinCommand,
        PlanBelowMinCommand,
        ApplyBelowMinCommand,
        BuildSweepReportCommand,
        PromoSweepService,
    ],
    controllers: [PromosController],
    exports: [PromosService, OzonSellerActionsApi, PromoSweepService],
})
export class PromosModule {}
