import { Module } from '@nestjs/common';
import { PostingService } from './posting.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { OzonApiModule } from "../ozon.api/ozon.api.module";
import { CreateOrGetExemplarsCommand } from './commands/create-or-get-exemplars.command';
import { BuildExemplarsPayloadCommand } from './commands/build-exemplars-payload.command';
import { ValidateExemplarsCommand } from './commands/validate-exemplars.command';
import { SetAndConfirmExemplarsCommand } from './commands/set-and-confirm-exemplars.command';
import { ShipExemplarsCommand } from './commands/ship-exemplars.command';

@Module({
    imports: [OzonApiModule, ProductModule, InvoiceModule],
    providers: [
        PostingService,
        CreateOrGetExemplarsCommand,
        BuildExemplarsPayloadCommand,
        ValidateExemplarsCommand,
        SetAndConfirmExemplarsCommand,
        ShipExemplarsCommand,
    ],
    exports: [PostingService],
})
export class PostingModule {}
