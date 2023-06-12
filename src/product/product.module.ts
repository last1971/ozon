import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { ProductController } from './product.controller';

@Module({
    imports: [OzonApiModule],
    providers: [ProductService],
    exports: [ProductService],
    controllers: [ProductController],
})
export class ProductModule {}
