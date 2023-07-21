import { Module } from '@nestjs/common';
import { YandexPriceService } from './yandex.price.service';
import { YandexOfferModule } from '../yandex.offer/yandex.offer.module';
import { GoodModule } from '../good/good.module';
import { PriceModule } from '../price/price.module';

@Module({
    imports: [YandexOfferModule, GoodModule, PriceModule],
    providers: [YandexPriceService],
    exports: [YandexPriceService],
})
export class YandexPriceModule {}
