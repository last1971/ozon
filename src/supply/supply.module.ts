import { Module } from '@nestjs/common';
import { SupplyController } from './supply.controller';
import { WbSupplyModule } from '../wb.supply/wb.supply.module';
import { Trade2006InvoiceModule } from '../trade2006.invoice/trade2006.invoice.module';
import { ProductModule } from 'src/product/product.module';
import { WbCardModule } from 'src/wb.card/wb.card.module';
@Module({
    imports: [WbSupplyModule, Trade2006InvoiceModule, ProductModule, WbCardModule],
    controllers: [SupplyController],
})
export class SupplyModule {}
