import { Module } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdPool } from 'ts-firebird';
import { InvoiceController } from './invoice.controller';
import { IsRemarkValid } from '../validators/is.remark.valid';
import { MarkScanFbsService } from './mark-scan-fbs.service';
import { GtdModule } from '../gtd/gtd.module';
import { GtdResolver } from '../gtd/gtd.resolver';
import { RETURN_STOCK } from '../interfaces/i.return.stock';
import { Trade2006ReturnStockService } from '../trade2006.invoice/trade2006.return-stock.service';

@Module({
    imports: [FirebirdModule, GtdModule],
    providers: [
        IsRemarkValid,
        MarkScanFbsService,
        { provide: RETURN_STOCK, useClass: Trade2006ReturnStockService },
        {
            provide: INVOICE_SERVICE,
            useFactory: (
                configService: ConfigService,
                pool: FirebirdPool,
                eventEmitter: EventEmitter2,
                gtdResolver: GtdResolver,
            ) => new Trade2006InvoiceService(pool, configService, eventEmitter, gtdResolver),
            inject: [ConfigService, FIREBIRD, EventEmitter2, GtdResolver],
        },
    ],
    exports: [INVOICE_SERVICE, RETURN_STOCK, MarkScanFbsService, IsRemarkValid],
    controllers: [InvoiceController],
})
export class InvoiceModule {}
