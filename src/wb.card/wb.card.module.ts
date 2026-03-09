import { Module } from '@nestjs/common';
import { WbCardService } from './wb.card.service';
import { WbApiModule } from '../wb.api/wb.api.module';
import { AIModule } from '../ai/ai.module';
import { WbCardController } from './wb.card.controller';
import { LoadWbCharcsCommand } from './commands/load-wb-charcs.command';
import { GenerateWbCharcsCommand } from './commands/generate-wb-charcs.command';
import { BuildWbCharcsCommand } from './commands/build-wb-charcs.command';

@Module({
    imports: [WbApiModule, AIModule],
    controllers: [WbCardController],
    providers: [
        WbCardService,
        LoadWbCharcsCommand,
        GenerateWbCharcsCommand,
        BuildWbCharcsCommand,
    ],
    exports: [WbCardService],
})
export class WbCardModule {}
