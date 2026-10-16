import { Module } from '@nestjs/common';
import { PostingFboService } from './posting.fbo.service';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { DonorTransferService } from './donor-transfer.service';
import { DonorApplyService } from './donor-apply.service';
import { FboShortageController } from './fbo-shortage.controller';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { LogShortageNotifyCommand } from './commands/log-shortage-notify.command';
import { CreateFboInvoiceCommand } from './commands/create-fbo-invoice.command';
import { PickupFboCommand } from './commands/pickup-fbo.command';
import { FboInvoiceCreatorService } from './fbo-invoice-creator.service';
import { FboShortageCloser } from './fbo-shortage-closer';
import { PeresortService } from './peresort.service';
import { LoadShortageLineCommand } from './peresort/load-shortage-line.command';
import { AssertNotMarkedCommand } from './peresort/assert-not-marked.command';
import { CreatePeresortDocCommand } from './peresort/create-peresort-doc.command';
import { PickupLineCommand } from './peresort/pickup-line.command';
import { CloseShortageCommand } from './peresort/close-shortage.command';

import { MpEventModule } from '../mp-event/mp-event.module';

@Module({
    imports: [ProductModule, InvoiceModule, MpEventModule],
    controllers: [FboShortageController],
    providers: [
        PostingFboService,
        FboMarkMigrationService,
        DonorTransferService,
        DonorApplyService,
        LogShortageNotifyCommand,
        CreateFboInvoiceCommand,
        PickupFboCommand,
        FboInvoiceCreatorService,
        FboShortageCloser,
        PeresortService,
        LoadShortageLineCommand,
        AssertNotMarkedCommand,
        CreatePeresortDocCommand,
        PickupLineCommand,
        CloseShortageCommand,
    ],
    exports: [PostingFboService, FboMarkMigrationService, DonorTransferService, FboInvoiceCreatorService],
})
export class PostingFboModule {}
