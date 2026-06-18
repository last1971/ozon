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

@Module({
    imports: [WbApiModule, InvoiceModule, PostingFboModule, ProcessedCacheModule],
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
