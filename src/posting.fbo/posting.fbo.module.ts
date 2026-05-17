import { Module } from '@nestjs/common';
import { PostingFboService } from './posting.fbo.service';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { ProductModule } from '../product/product.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
    imports: [ProductModule, InvoiceModule],
    providers: [PostingFboService, FboMarkMigrationService],
    exports: [PostingFboService, FboMarkMigrationService],
})
export class PostingFboModule {}
