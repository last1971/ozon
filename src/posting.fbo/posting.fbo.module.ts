import { Module } from '@nestjs/common';
import { PostingFboService } from './posting.fbo.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
    imports: [ProductModule, InvoiceModule],
    providers: [PostingFboService],
    exports: [PostingFboService],
})
export class PostingFboModule {}
