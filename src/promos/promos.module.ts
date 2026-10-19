import { Module } from '@nestjs/common';
import { PriceModule } from 'src/price/price.module';
import { ProductModule } from 'src/product/product.module';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';
import { OzonSellerActionsApi } from './seller-actions.api';
import { PromoPriceApplier } from './price-lever/promo-price.applier';
import { PromoPriceService } from './price-lever/promo-price.service';

@Module({
    imports: [OzonApiModule, ProductModule, PriceModule],
    providers: [OzonPromosApi, OzonSellerActionsApi, PromosService, PromoPriceService, PromoPriceApplier],
    controllers: [PromosController],
    exports: [PromosService, OzonSellerActionsApi],
})
export class PromosModule {}
