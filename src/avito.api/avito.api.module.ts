import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AvitoApiService } from './avito.api.service';

@Module({
    imports: [HttpModule],
    providers: [AvitoApiService],
    exports: [AvitoApiService],
})
export class AvitoApiModule {}