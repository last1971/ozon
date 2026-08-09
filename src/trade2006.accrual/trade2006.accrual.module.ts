import { Module } from '@nestjs/common';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { AccrualWeekService } from './accrual.week.service';
import { FirebirdModule } from '../firebird/firebird.module';
import { Trade2006InvoiceModule } from '../trade2006.invoice/trade2006.invoice.module';
import { ProductModule } from '../product/product.module';

@Module({
    imports: [FirebirdModule, Trade2006InvoiceModule, ProductModule],
    providers: [Trade2006AccrualService, AccrualWeekService],
    exports: [Trade2006AccrualService, AccrualWeekService],
})
export class Trade2006AccrualModule {}
