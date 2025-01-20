import { Module } from '@nestjs/common';
import { PromosService } from './promos.service';
import { PromosController } from './promos.controller';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { ProductModule } from 'src/product/product.module';

@Module({
    imports: [OzonApiModule, ProductModule],
    providers: [PromosService],
    controllers: [PromosController],
    exports: [PromosService],
})
export class PromosModule {}
