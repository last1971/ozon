import { Module } from '@nestjs/common';
import { WbApiService } from './wb.api.service';
import { HttpModule } from '@nestjs/axios';
import { RateLimitRetryPolicy } from '../helpers/rate-limit.retry.policy';

@Module({
    imports: [HttpModule],
    providers: [
        WbApiService,
        { provide: RateLimitRetryPolicy, useValue: new RateLimitRetryPolicy(RateLimitRetryPolicy.WB) },
    ],
    exports: [WbApiService],
})
export class WbApiModule {}
