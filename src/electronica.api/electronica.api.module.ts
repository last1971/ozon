import { Module } from '@nestjs/common';
import { ElectronicaApiService } from './electronica.api.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [HttpModule, ConfigModule],
    providers: [ElectronicaApiService],
    exports: [ElectronicaApiService],
})
export class ElectronicaApiModule {}
