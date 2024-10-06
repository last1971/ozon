import { Module } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdPool } from 'ts-firebird';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { InvoiceController } from './invoice.controller';
import { IsRemarkValid } from "../validators/is.remark.valid";

@Module({
    imports: [FirebirdModule],
    providers: [
        IsRemarkValid,
        {
            provide: INVOICE_SERVICE,
            useFactory: (
                configService: ConfigService,
                pool: FirebirdPool,
                eventEmitter: EventEmitter2,
                cacheManager: Cache,
            ) => new Trade2006InvoiceService(pool, configService, eventEmitter, cacheManager),
            inject: [ConfigService, FIREBIRD, EventEmitter2, CACHE_MANAGER],
        },
    ],
    exports: [INVOICE_SERVICE],
    controllers: [InvoiceController],
})
export class InvoiceModule {}
