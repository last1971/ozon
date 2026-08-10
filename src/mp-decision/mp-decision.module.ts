import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { MpDecisionService } from './mp-decision.service';
import { MpDecisionDryRunService } from './mp-decision.dry-run.service';
import { StuckCodesService } from './stuck-codes.service';

@Module({
    imports: [InvoiceModule, MpEventModule],
    providers: [MpDecisionService, MpDecisionDryRunService, StuckCodesService],
    exports: [MpDecisionService, MpDecisionDryRunService],
})
export class MpDecisionModule {}
