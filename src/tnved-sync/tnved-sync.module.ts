import { Module } from '@nestjs/common';
import { ProductModule } from '../product/product.module';
import { FirebirdModule } from '../firebird/firebird.module';
import { TnvedSyncController } from './tnved-sync.controller';
import { TnvedSyncService } from './tnved-sync.service';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { WbCardModule } from '../wb.card/wb.card.module';
import { WbApiModule } from '../wb.api/wb.api.module';

@Module({
    imports: [ProductModule, FirebirdModule, WbCardModule, WbApiModule],
    controllers: [TnvedSyncController],
    providers: [TnvedSyncService, OzonTnvedService, WbTnvedService],
})
export class TnvedSyncModule {}
