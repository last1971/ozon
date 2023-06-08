import { Module } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { FirebirdDatabase } from 'ts-firebird';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
@Module({
    imports: [FirebirdModule],
    providers: [
        {
            provide: INVOICE_SERVICE,
            useFactory: (configService: ConfigService, dataBase: FirebirdDatabase) =>
                new Trade2006InvoiceService(dataBase, configService),
            inject: [ConfigService, FIREBIRD],
        },
    ],
    exports: [INVOICE_SERVICE],
})
export class InvoiceModule {}
