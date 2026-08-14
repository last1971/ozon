import { Module } from '@nestjs/common';
import { ChzModule } from '../chz/chz.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { MpDecisionService } from './mp-decision.service';
import { MpDecisionRunnerService } from './mp-decision.runner.service';
import { StuckCodesService } from './stuck-codes.service';

@Module({
    imports: [InvoiceModule, MpEventModule, ChzModule],
    providers: [MpDecisionService, MpDecisionRunnerService, StuckCodesService],
    exports: [MpDecisionService, MpDecisionRunnerService],
})
export class MpDecisionModule {}
