import { Module } from '@nestjs/common';
import { PriceModule } from 'src/price/price.module';
import { ProductModule } from 'src/product/product.module';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

@Module({
    imports: [OzonApiModule, ProductModule, PriceModule],
    providers: [OzonPromosApi, PromosService],
    controllers: [PromosController],
    exports: [PromosService],
})
export class PromosModule {}
