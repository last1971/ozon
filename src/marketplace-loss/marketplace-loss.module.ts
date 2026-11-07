import { MpEventModule } from '../mp-event/mp-event.module';
import { LossPriceQueueStore } from './prices/loss-price-queue.store';
import { LossPricingService } from './loss-pricing.service';
import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { LOSS_STATS_STORE } from './loss.contracts';
import { LossStatsStore } from './loss-stats.store';
import { SaveLossSnapshotCommand } from './loss.commands';

@Module({
    imports: [FirebirdModule, MpEventModule],
    providers: [
        LossPriceQueueStore,
        LossPricingService,
        LossStatsStore,
        { provide: LOSS_STATS_STORE, useExisting: LossStatsStore },
        SaveLossSnapshotCommand,
    ],
    exports: [LossPriceQueueStore, LossPricingService, LOSS_STATS_STORE, LossStatsStore, SaveLossSnapshotCommand],
})
export class MarketplaceLossModule {}
