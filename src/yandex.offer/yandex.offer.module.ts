import { Module } from '@nestjs/common';
import { YandexOfferService } from './yandex.offer.service';
import { YandexApiService } from '../yandex.api/yandex.api.service';

@Module({
    imports: [YandexApiService],
    providers: [YandexOfferService],
    exports: [YandexOfferService],
})
export class YandexOfferModule {}
