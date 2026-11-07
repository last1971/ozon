import {
    LoadOzonLossFinancialsCommand,
    ReadOzonLossFeesCommand,
    ResolveOzonLossExpensesCommand,
    CalculateOzonLossExpensesCommand,
    OzonLossFinancialCommands,
} from './ozon.loss.expense.commands';
import { JobModule } from '../job/job.module';
import { OzonReturnService } from './ozon.return.service';
import { OzonReturnStore } from './ozon.return.store';
import { Module } from '@nestjs/common';
import { MpEventModule } from '../mp-event/mp-event.module';
import { OzonReturnPreviewService } from './ozon.return.preview.service';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { AccrualWeekService } from './accrual.week.service';
import { FirebirdModule } from '../firebird/firebird.module';
import { Trade2006InvoiceModule } from '../trade2006.invoice/trade2006.invoice.module';
import { ProductModule } from '../product/product.module';

@Module({
    imports: [JobModule, FirebirdModule, Trade2006InvoiceModule, ProductModule, MpEventModule],
    providers: [
        Trade2006AccrualService,
        AccrualWeekService,
        OzonReturnPreviewService,
        OzonReturnStore,
        OzonReturnService,
        LoadOzonLossFinancialsCommand,
        ReadOzonLossFeesCommand,
        ResolveOzonLossExpensesCommand,
        OzonLossFinancialCommands,
        CalculateOzonLossExpensesCommand,
    ],
    exports: [Trade2006AccrualService, AccrualWeekService, OzonReturnPreviewService, OzonReturnService],
})
export class Trade2006AccrualModule {}
