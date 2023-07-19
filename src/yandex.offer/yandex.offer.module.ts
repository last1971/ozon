import { Module } from '@nestjs/common';
import { YandexOfferService } from './yandex.offer.service';
import { YandexApiModule } from '../yandex.api/yandex.api.module';
import { ExpressOfferService } from './express.offer.service';

@Module({
    imports: [YandexApiModule],
    providers: [YandexOfferService, ExpressOfferService],
    exports: [YandexOfferService, ExpressOfferService],
})
export class YandexOfferModule {}
