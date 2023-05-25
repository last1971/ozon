import { Module } from '@nestjs/common';
import { OzonApiService } from './ozon.api.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule, ConfigModule],
    providers: [OzonApiService],
    exports: [OzonApiService],
})
export class OzonApiModule {}
