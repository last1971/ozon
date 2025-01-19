import { Module } from '@nestjs/common';
import { PromosService } from './promos.service';
import { PromosController } from './promos.controller';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { ProductService } from 'src/product/product.service';
import { OzonApiService } from 'src/ozon.api/ozon.api.service';
import { ProductModule } from 'src/product/product.module';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [OzonApiModule], // HttpModule, ProductModule
    providers: [PromosService], // OzonApiService, ProductService
    controllers: [PromosController],
    exports: [PromosService],
})
export class PromosModule {}
