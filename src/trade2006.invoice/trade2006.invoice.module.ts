import { Module } from '@nestjs/common';
import { Trade2006InvoiceService } from './trade2006.invoice.service';
import { FirebirdModule } from '../firebird/firebird.module';

@Module({
    imports: [FirebirdModule],
    providers: [Trade2006InvoiceService],
})
export class Trade2006InvoiceModule {}
