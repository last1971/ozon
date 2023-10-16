import { Module } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdPool } from 'ts-firebird';

@Module({
    imports: [FirebirdModule],
    providers: [
        {
            provide: INVOICE_SERVICE,
            useFactory: (configService: ConfigService, pool: FirebirdPool, eventEmitter: EventEmitter2) =>
                new Trade2006InvoiceService(pool, configService, eventEmitter),
            inject: [ConfigService, FIREBIRD, EventEmitter2],
        },
    ],
    exports: [INVOICE_SERVICE],
})
export class InvoiceModule {}
