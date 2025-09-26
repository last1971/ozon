import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { AvitoApiService } from './avito.api.service';

@Module({
    imports: [HttpModule],
    providers: [AvitoApiService, VaultService],
    exports: [AvitoApiService],
})
export class AvitoApiModule {}