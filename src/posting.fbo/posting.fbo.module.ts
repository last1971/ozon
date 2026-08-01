import { Module } from '@nestjs/common';
import { PostingFboService } from './posting.fbo.service';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { LogShortageNotifyCommand } from './commands/log-shortage-notify.command';
import { CreateFboInvoiceCommand } from './commands/create-fbo-invoice.command';
import { PickupFboCommand } from './commands/pickup-fbo.command';
import { FboInvoiceCreatorService } from './fbo-invoice-creator.service';

@Module({
    imports: [ProductModule, InvoiceModule],
    providers: [
        PostingFboService,
        FboMarkMigrationService,
        LogShortageNotifyCommand,
        CreateFboInvoiceCommand,
        PickupFboCommand,
        FboInvoiceCreatorService,
    ],
    exports: [PostingFboService, FboMarkMigrationService, FboInvoiceCreatorService],
})
export class PostingFboModule {}
