import { Module } from '@nestjs/common';
import { Trade2006InvoiceService } from './trade2006.invoice.service';
import { FirebirdModule } from '../firebird/firebird.module';
import { GtdModule } from '../gtd/gtd.module';

@Module({
    imports: [FirebirdModule, GtdModule],
    providers: [Trade2006InvoiceService],
    exports: [Trade2006InvoiceService],
})
export class Trade2006InvoiceModule {}
