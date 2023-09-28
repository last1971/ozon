import { Module } from '@nestjs/common';
import { WbApiService } from './wb.api.service';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule],
    providers: [WbApiService],
    exports: [WbApiService],
})
export class WbApiModule {}
