import { Module } from '@nestjs/common';
import { JobModule } from '../../job/job.module';
import { BulkPriceJobService } from './bulk-price-job.service';
import { CollectBulkPricesCommand } from './collect-bulk-prices.command';
import { UpdateBulkPricesCommand } from './update-bulk-prices.command';
import { ReportBulkPricesCommand } from './report-bulk-prices.command';
@Module({
    imports: [JobModule],
    providers: [BulkPriceJobService, CollectBulkPricesCommand, UpdateBulkPricesCommand, ReportBulkPricesCommand],
    exports: [BulkPriceJobService],
})
export class BulkPriceJobModule {}
