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
import { BuildPeresortDocCommand } from './peresort/build-peresort-doc.command';
import { SpisModule } from '../helpers/spis/spis.module';
import { PickupLineCommand } from './peresort/pickup-line.command';
import { CloseShortageCommand } from './peresort/close-shortage.command';

import { MpEventModule } from '../mp-event/mp-event.module';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { FirebirdModule } from '../firebird/firebird.module';
import { DonorPiecesService } from './donor-pieces/donor-pieces.service';
import { DonorPiecesStore } from './donor-pieces/donor-pieces.store';
import { OzonSupplyClient } from './donor-pieces/ozon-supply.client';
import { LoadDonorsCommand } from './donor-pieces/commands/load-donors.command';
import { FetchSuppliesCommand } from './donor-pieces/commands/fetch-supplies.command';
import { MatchSuppliesCommand } from './donor-pieces/commands/match-supplies.command';
import { WritePiecesCommand } from './donor-pieces/commands/write-pieces.command';
import { JournalOutcomesCommand } from './donor-pieces/commands/journal-outcomes.command';

@Module({
    imports: [ProductModule, InvoiceModule, MpEventModule, SpisModule, OzonApiModule, FirebirdModule],
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
        BuildPeresortDocCommand,
        PickupLineCommand,
        CloseShortageCommand,
        DonorPiecesService,
        DonorPiecesStore,
        OzonSupplyClient,
        LoadDonorsCommand,
        FetchSuppliesCommand,
        MatchSuppliesCommand,
        WritePiecesCommand,
        JournalOutcomesCommand,
    ],
    exports: [PostingFboService, FboMarkMigrationService, DonorTransferService, FboInvoiceCreatorService],
})
export class PostingFboModule {}
