import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { OzonApiModule } from '../ozon.api/ozon.api.module';

@Module({
    imports: [OzonApiModule],
    providers: [ProductService],
    exports: [ProductService],
})
export class ProductModule {}
