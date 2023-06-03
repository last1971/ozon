import { Module } from '@nestjs/common';
import { OzonApiService } from './ozon.api.service';
import { HttpModule } from '@nestjs/axios';
import { VaultModule } from '../vault/vault.module';

@Module({
    imports: [HttpModule, VaultModule],
    providers: [OzonApiService],
    exports: [OzonApiService],
})
export class OzonApiModule {}
