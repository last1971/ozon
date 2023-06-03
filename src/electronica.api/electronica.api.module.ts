import { Module } from '@nestjs/common';
import { ElectronicaApiService } from './electronica.api.service';
import { HttpModule } from '@nestjs/axios';
import { VaultModule } from '../vault/vault.module';

@Module({
    imports: [HttpModule, VaultModule],
    providers: [ElectronicaApiService],
    exports: [ElectronicaApiService],
})
export class ElectronicaApiModule {}
