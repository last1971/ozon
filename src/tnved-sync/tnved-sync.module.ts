import { Module } from '@nestjs/common';
import { ProductModule } from '../product/product.module';
import { FirebirdModule } from '../firebird/firebird.module';
import { TnvedSyncController } from './tnved-sync.controller';
import { TnvedSyncService } from './tnved-sync.service';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { WbCardModule } from '../wb.card/wb.card.module';
import { WbApiModule } from '../wb.api/wb.api.module';
import { ProcessedCacheModule } from '../processed-cache/processed-cache.module';
import { JobModule } from '../job/job.module';
import { LoadBaseTnvedCommand } from './commands/load-base-tnved.command';
import { SkipProcessedCommand } from './commands/skip-processed.command';
import { CheckTnvedCommand } from './commands/check-tnved.command';
import { BuildTnvedReportCommand } from './commands/build-tnved-report.command';
import { UpdateTnvedCommand } from './commands/update-tnved.command';
import { MarkProcessedCommand } from './commands/mark-processed.command';
import { LoadMarketOffersCommand } from './commands/load-market-offers.command';
import { LoadBaseGoodsCommand } from './commands/load-base-goods.command';
import { DiffMissingTnvedCommand } from './commands/diff-missing-tnved.command';

const TNVED_COMMANDS = [
    LoadBaseTnvedCommand,
    SkipProcessedCommand,
    CheckTnvedCommand,
    BuildTnvedReportCommand,
    UpdateTnvedCommand,
    MarkProcessedCommand,
    LoadMarketOffersCommand,
    LoadBaseGoodsCommand,
    DiffMissingTnvedCommand,
];

@Module({
    imports: [ProductModule, FirebirdModule, WbCardModule, WbApiModule, ProcessedCacheModule, JobModule],
    controllers: [TnvedSyncController],
    providers: [TnvedSyncService, OzonTnvedService, WbTnvedService, ...TNVED_COMMANDS],
})
export class TnvedSyncModule {}
