import { Module } from '@nestjs/common';
import { PostingService } from './posting.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { OzonApiModule } from "../ozon.api/ozon.api.module";

@Module({
    imports: [OzonApiModule, ProductModule, InvoiceModule],
    providers: [PostingService],
    exports: [PostingService],
})
export class PostingModule {}
