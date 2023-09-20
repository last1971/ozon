import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductService } from './product/product.service';
import { GOOD_SERVICE, IGood } from './interfaces/IGood';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class AppService {
    private logger = new Logger(AppService.name);
    constructor(
        private productService: ProductService,
        private yandexOffer: YandexOfferService,
        private expressOffer: ExpressOfferService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
    ) {}
    getHello(): string {
        return 'Hello World!';
    }
    @Cron('0 0 9-19 * * 1-6', { name: 'checkGoodCount' })
    async checkGoodCount(): Promise<void> {
        this.logger.log(
            `Update quantity for ${await this.goodService.updateCountForService(
                this.productService,
                '',
            )} goods in ozon`,
        );
        this.logger.log(
            `Update quantity for ${await this.goodService.updateCountForService(this.yandexOffer, '')} goods in yandex`,
        );
        this.logger.log(
            `Update quantity for ${await this.goodService.updateCountForService(
                this.expressOffer,
                '',
            )} goods in express`,
        );
    }

    @OnEvent('reserve.created')
    async reserveCreated(skus: string[]): Promise<void> {
        this.logger.log('Sku - ' + skus.join() + ' was reserved');
        let count: number;
        for (const service of [this.yandexOffer, this.expressOffer, this.productService]) {
            count = await this.goodService.updateCountForSkus(service, skus);
        }
        this.logger.log(`Update quantity for ${count} goods`);
    }
}
