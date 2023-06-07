import { Module } from '@nestjs/common';
import { ElectronicaApiService } from './electronica.api.service';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule],
    providers: [ElectronicaApiService],
    exports: [ElectronicaApiService],
})
export class ElectronicaApiModule {}
