import { Inject, Injectable } from '@nestjs/common';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class YandexPriceService {
    constructor(
        @Inject(GOOD_SERVICE) private goodService,
        private offerService: YandexOfferService,
        private priceService: PriceService,
    ) {}
    async updatePrices(args = ''): Promise<void> {
        const offers = this.offerService.getShopSkus(args);
    }
}
