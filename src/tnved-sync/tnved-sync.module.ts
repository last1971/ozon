import { Module } from '@nestjs/common';
import { ProductModule } from '../product/product.module';
import { FirebirdModule } from '../firebird/firebird.module';
import { TnvedSyncController } from './tnved-sync.controller';
import { TnvedSyncService } from './tnved-sync.service';

@Module({
    imports: [ProductModule, FirebirdModule],
    controllers: [TnvedSyncController],
    providers: [TnvedSyncService],
})
export class TnvedSyncModule {}
