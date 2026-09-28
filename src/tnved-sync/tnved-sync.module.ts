import { Module } from '@nestjs/common';
import { ProductModule } from '../product/product.module';
import { FirebirdModule } from '../firebird/firebird.module';
import { TnvedSyncController } from './tnved-sync.controller';
import { CardSyncService } from './card-sync.service';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { OzonGtinService } from './ozon.gtin.service';
import { WbGtinService } from './wb.gtin.service';
import { WbCardModule } from '../wb.card/wb.card.module';
import { WbApiModule } from '../wb.api/wb.api.module';
import { ProcessedCacheModule } from '../processed-cache/processed-cache.module';
import { JobModule } from '../job/job.module';
import { LoadBaseTnvedCommand } from './commands/load-base-tnved.command';
import { LoadBaseGtinCommand } from './commands/load-base-gtin.command';
import { SkipProcessedCommand } from './commands/skip-processed.command';
import { CheckCardsCommand } from './commands/check-cards.command';
import { BuildSyncReportCommand } from './commands/build-sync-report.command';
import { UpdateCardsCommand } from './commands/update-cards.command';
import { MarkProcessedCommand } from './commands/mark-processed.command';
import { LoadMarketOffersCommand } from './commands/load-market-offers.command';
import { LoadBaseGoodsCommand } from './commands/load-base-goods.command';
import { DiffMissingTnvedCommand } from './commands/diff-missing-tnved.command';

const SYNC_COMMANDS = [
    LoadBaseTnvedCommand,
    LoadBaseGtinCommand,
    SkipProcessedCommand,
    CheckCardsCommand,
    BuildSyncReportCommand,
    UpdateCardsCommand,
    MarkProcessedCommand,
    LoadMarketOffersCommand,
    LoadBaseGoodsCommand,
    DiffMissingTnvedCommand,
];

@Module({
    imports: [ProductModule, FirebirdModule, WbCardModule, WbApiModule, ProcessedCacheModule, JobModule],
    controllers: [TnvedSyncController],
    providers: [CardSyncService, OzonTnvedService, WbTnvedService, OzonGtinService, WbGtinService, ...SYNC_COMMANDS],
    // WbTnvedService наружу — ради справочника ТН ВЭД предметов (WbDictModule) через общую калитку к ВБ
    exports: [WbTnvedService],
})
export class TnvedSyncModule {}
