import { Module } from '@nestjs/common';
import { WbOrderService } from './wb.order.service';
import { WbApiModule } from '../wb.api/wb.api.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
    imports: [WbApiModule, InvoiceModule],
    providers: [WbOrderService],
    exports: [WbOrderService],
})
export class WbOrderModule {}
