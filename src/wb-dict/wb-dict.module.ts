import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { JobModule } from '../job/job.module';
import { TnvedSyncModule } from '../tnved-sync/tnved-sync.module';
import { WbPriceModule } from '../wb.price/wb.price.module';
import { WbDictController } from './wb-dict.controller';
import { WbDictService } from './wb-dict.service';
import { WbCategoriesRepository } from './wb-categories.repository';
import { WbTnvedMapService } from './wb-tnved-map.service';
import { LoadWbCommissionsCommand } from './commands/load-wb-commissions.command';
import { LoadWbTnvedCommand } from './commands/load-wb-tnved.command';
import { BuildWbTnvedMapCommand } from './commands/build-wb-tnved-map.command';

@Module({
    imports: [FirebirdModule, JobModule, TnvedSyncModule, WbPriceModule],
    controllers: [WbDictController],
    providers: [WbDictService, WbCategoriesRepository, WbTnvedMapService, LoadWbCommissionsCommand, LoadWbTnvedCommand, BuildWbTnvedMapCommand],
    exports: [WbDictService],
})
export class WbDictModule {}
