import { JobModule } from '../job/job.module';
import { WbMinPriceCheckCommand } from './wb-min-price-check.command';
import { MarketplaceLossModule } from '../marketplace-loss/marketplace-loss.module';
import { BulkPriceJobModule } from '../price/bulk/bulk-price-job.module';
import { Module } from '@nestjs/common';
import { WbPriceService } from './wb.price.service';
import { GoodModule } from '../good/good.module';
import { WbApiModule } from '../wb.api/wb.api.module';
import { WbCardModule } from '../wb.card/wb.card.module';
import { WbCurrentPricesModule } from './wb.current-prices.module';
import { WbMinPriceGuard } from './wb.min-price.guard';

@Module({
    imports: [
        JobModule,
        MarketplaceLossModule,
        BulkPriceJobModule,
        GoodModule,
        WbApiModule,
        WbCardModule,
        WbCurrentPricesModule,
    ],
    providers: [WbPriceService, WbMinPriceGuard, WbMinPriceCheckCommand],
    exports: [WbPriceService],
})
export class WbPriceModule {}
