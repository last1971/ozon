import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { LOSS_STATS_STORE } from './loss.contracts';
import { LossStatsStore } from './loss-stats.store';
import { SaveLossSnapshotCommand } from './loss.commands';

@Module({
    imports: [FirebirdModule],
    providers: [LossStatsStore, { provide: LOSS_STATS_STORE, useExisting: LossStatsStore }, SaveLossSnapshotCommand],
    exports: [LOSS_STATS_STORE, LossStatsStore, SaveLossSnapshotCommand],
})
export class MarketplaceLossModule {}
