import { Module } from '@nestjs/common';
import { OzonApiService } from './ozon.api.service';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule],
    providers: [OzonApiService],
    exports: [OzonApiService],
})
export class OzonApiModule {}
