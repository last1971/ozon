import {
    PrepareWbLossFinancialCommand,
    ReconcileWbLossExpensesCommand,
    WbLossFinancialCommands,
} from './returns/wb-loss-financial.commands';
import { WbFinancialReportService } from './finance/financial-report.service';
import { WbFinancialReportReader } from './finance/financial-report.reader';
import {
    ValidateWbFinancialReportCommand,
    LoadWbFinancialReportCommand,
    NormalizeWbFinancialReportCommand,
} from './finance/financial-report.commands';
import { MarketplaceLossModule } from '../marketplace-loss/marketplace-loss.module';
import { WbLossService } from './returns/wb-loss.service';
import { JobModule } from '../job/job.module';
import { WbReturnPreviewController } from './returns/return-preview.controller';
import { WbReturnPreviewService } from './returns/return-preview.service';
import { LoadWbLossSalesCommand } from './returns/load-sales.command';
import { LoadWbWriteOffsCommand } from './returns/load-write-offs.command';
import { CalculateWbLossReportCommand } from './returns/calculate-loss-report.command';
import { Module } from '@nestjs/common';
import { WbOrderService } from './wb.order.service';
import { WbApiModule } from '../wb.api/wb.api.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { PostingFboModule } from '../posting.fbo/posting.fbo.module';
import { FetchSalesByStickerCommand } from './commands/fetch-sales-by-sticker.command';
import { FetchOrdersByStickerCommand } from './commands/fetch-orders-by-sticker.command';
import { FetchTransactionsCommand } from './commands/fetch-transactions.command';
import { SelectBestIdCommand } from './commands/select-best-id.command';
import { FetchInvoiceByRemarkCommand } from './commands/fetch-invoice-by-remark.command';
import { ProcessedCacheModule } from '../processed-cache/processed-cache.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { MpDecisionModule } from '../mp-decision/mp-decision.module';
import { WbCustomerModule } from '../wb.customer/wb.customer.module';
import { WbCurrentPricesModule } from '../wb.price/wb.current-prices.module';

@Module({
    controllers: [WbReturnPreviewController],
    imports: [
        JobModule,
        MarketplaceLossModule,
        WbApiModule,
        InvoiceModule,
        PostingFboModule,
        ProcessedCacheModule,
        MpEventModule,
        MpDecisionModule,
        WbCustomerModule,
        WbCurrentPricesModule,
    ],
    providers: [
        WbFinancialReportService,
        WbFinancialReportReader,
        ValidateWbFinancialReportCommand,
        LoadWbFinancialReportCommand,
        NormalizeWbFinancialReportCommand,
        WbReturnPreviewService,
        WbLossService,
        PrepareWbLossFinancialCommand,
        ReconcileWbLossExpensesCommand,
        WbLossFinancialCommands,
        LoadWbLossSalesCommand,
        LoadWbWriteOffsCommand,
        CalculateWbLossReportCommand,
        WbOrderService,
        FetchSalesByStickerCommand,
        FetchOrdersByStickerCommand,
        FetchTransactionsCommand,
        SelectBestIdCommand,
        FetchInvoiceByRemarkCommand,
    ],
    exports: [WbOrderService, WbLossService, WbFinancialReportService],
})
export class WbOrderModule {}
