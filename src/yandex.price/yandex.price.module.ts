import { Module } from '@nestjs/common';
import { YandexPriceService } from './yandex.price.service';
import { YandexOfferModule } from '../yandex.offer/yandex.offer.module';
import { GoodModule } from '../good/good.module';
import { YandexApiModule } from '../yandex.api/yandex.api.module';

@Module({
    imports: [YandexOfferModule, GoodModule, YandexApiModule],
    providers: [YandexPriceService],
    exports: [YandexPriceService],
})
export class YandexPriceModule {}
