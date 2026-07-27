import { Module } from '@nestjs/common';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { FirebirdModule } from '../firebird/firebird.module';
import { TnvedSyncController } from './tnved-sync.controller';
import { TnvedSyncService } from './tnved-sync.service';

@Module({
    imports: [OzonApiModule, FirebirdModule],
    controllers: [TnvedSyncController],
    providers: [TnvedSyncService],
})
export class TnvedSyncModule {}
