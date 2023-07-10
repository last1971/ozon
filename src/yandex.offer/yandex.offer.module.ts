import { Module } from '@nestjs/common';
import { YandexOfferService } from './yandex.offer.service';
import { YandexApiModule } from '../yandex.api/yandex.api.module';

@Module({
    imports: [YandexApiModule],
    providers: [YandexOfferService],
    exports: [YandexOfferService],
})
export class YandexOfferModule {}
