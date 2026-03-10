import { Module } from '@nestjs/common';
import { WbCardService } from './wb.card.service';
import { WbApiModule } from '../wb.api/wb.api.module';
import { AIModule } from '../ai/ai.module';
import { ProductModule } from '../product/product.module';
import { OzonCategoryModule } from '../ozon.category/ozon.category.module';
import { WbCardController } from './wb.card.controller';
import { LoadWbCharcsCommand } from './commands/load-wb-charcs.command';
import { GenerateWbCharcsCommand } from './commands/generate-wb-charcs.command';
import { BuildWbCharcsCommand } from './commands/build-wb-charcs.command';
import { FetchOzonCardCommand } from './commands/fetch-ozon-card.command';
import { ResolveWbCategoryCommand } from './commands/resolve-wb-category.command';
import { CheckWbCardExistsCommand } from './commands/check-wb-card-exists.command';
import { ShortenTitleCommand } from './commands/shorten-title.command';
import { BuildWbUploadBodyCommand } from './commands/build-wb-upload-body.command';
import { SubmitWbCardCommand } from './commands/submit-wb-card.command';

@Module({
    imports: [WbApiModule, AIModule, ProductModule, OzonCategoryModule],
    controllers: [WbCardController],
    providers: [
        WbCardService,
        LoadWbCharcsCommand,
        GenerateWbCharcsCommand,
        BuildWbCharcsCommand,
        FetchOzonCardCommand,
        ResolveWbCategoryCommand,
        CheckWbCardExistsCommand,
        ShortenTitleCommand,
        BuildWbUploadBodyCommand,
        SubmitWbCardCommand,
    ],
    exports: [WbCardService],
})
export class WbCardModule {}
