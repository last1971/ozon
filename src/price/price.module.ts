import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { ProductModule } from '../product/product.module';
import { GoodModule } from '../good/good.module';
import { YandexPriceModule } from '../yandex.price/yandex.price.module';
import { WbPriceModule } from '../wb.price/wb.price.module';

@Module({
    imports: [ProductModule, GoodModule, YandexPriceModule, WbPriceModule],
    providers: [PriceService],
    controllers: [PriceController],
    exports: [PriceService],
})
export class PriceModule {}
