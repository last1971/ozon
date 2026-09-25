import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { JobModule } from '../job/job.module';
import { TnvedSyncModule } from '../tnved-sync/tnved-sync.module';
import { WbPriceModule } from '../wb.price/wb.price.module';
import { OzonCategoryModule } from '../ozon.category/ozon.category.module';
import { ProductModule } from '../product/product.module';
import { DictController } from './dict.controller';
import { DictService } from './dict.service';
import { TnvedMapService } from './tnved-map.service';
import { WbDictService } from './wb.dict.service';
import { OzonDictService } from './ozon.dict.service';
import { LoadCategoriesCommand } from './commands/load-categories.command';
import { LoadTnvedCommand } from './commands/load-tnved.command';
import { BuildTnvedMapCommand } from './commands/build-tnved-map.command';

@Module({
    imports: [FirebirdModule, JobModule, TnvedSyncModule, WbPriceModule, OzonCategoryModule, ProductModule],
    controllers: [DictController],
    providers: [DictService, TnvedMapService, WbDictService, OzonDictService, LoadCategoriesCommand, LoadTnvedCommand, BuildTnvedMapCommand],
    exports: [DictService],
})
export class DictModule {}
