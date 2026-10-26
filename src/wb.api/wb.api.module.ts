import { Module } from '@nestjs/common';
import { WbApiService } from './wb.api.service';
import { WbGoodsReturnReportService } from './wb.goods-return.report.service';
import { HttpModule } from '@nestjs/axios';
import { RateLimitRetryPolicy } from '../helpers/rate-limit.retry.policy';

@Module({
    imports: [HttpModule],
    providers: [
        WbApiService,
        WbGoodsReturnReportService,
        { provide: RateLimitRetryPolicy, useValue: new RateLimitRetryPolicy(RateLimitRetryPolicy.WB) },
    ],
    exports: [WbApiService, WbGoodsReturnReportService],
})
export class WbApiModule {}
