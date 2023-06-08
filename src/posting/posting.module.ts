import { Module } from '@nestjs/common';
import { PostingService } from './posting.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
    imports: [ProductModule, InvoiceModule],
    providers: [PostingService],
    exports: [PostingService],
})
export class PostingModule {}
