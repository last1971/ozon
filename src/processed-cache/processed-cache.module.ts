import { Module } from '@nestjs/common';
import { ProcessedCacheService } from './processed-cache.service';

@Module({
    providers: [ProcessedCacheService],
    exports: [ProcessedCacheService],
})
export class ProcessedCacheModule {}
