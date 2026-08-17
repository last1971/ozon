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

@Module({
    imports: [
        WbApiModule,
        InvoiceModule,
        PostingFboModule,
        ProcessedCacheModule,
        MpEventModule,
        MpDecisionModule,
        WbCustomerModule,
    ],
    providers: [
        WbOrderService,
        FetchSalesByStickerCommand,
        FetchOrdersByStickerCommand,
        FetchTransactionsCommand,
        SelectBestIdCommand,
        FetchInvoiceByRemarkCommand,
    ],
    exports: [WbOrderService],
})
export class WbOrderModule {}
