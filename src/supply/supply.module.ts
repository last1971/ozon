import { Module } from '@nestjs/common';
import { SupplyController } from './supply.controller';
import { WbSupplyModule } from '../wb.supply/wb.supply.module';
import { Trade2006InvoiceModule } from '../trade2006.invoice/trade2006.invoice.module';

@Module({
    imports: [WbSupplyModule, Trade2006InvoiceModule],
    controllers: [SupplyController],
})
export class SupplyModule {}
