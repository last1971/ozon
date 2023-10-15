import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductService } from './product/product.service';
import { GOOD_SERVICE, IGood } from './interfaces/IGood';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';
import { OnEvent } from '@nestjs/event-emitter';
import { WbCardService } from './wb.card/wb.card.service';

@Injectable()
export class AppService {
    private logger = new Logger(AppService.name);
    constructor(
        private productService: ProductService,
        private yandexOffer: YandexOfferService,
        private expressOffer: ExpressOfferService,
        private wbCard: WbCardService,
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
        this.logger.log(
            `Update quantity for ${await this.goodService.updateCountForService(this.wbCard, '')} goods in wb`,
        );
    }

    @OnEvent('reserve.created', { async: true })
    async reserveCreated(skus: string[]): Promise<void> {
        this.logger.log('Sku - ' + skus.join() + ' was reserved');
        let count: number = 0;
        for (const service of [this.yandexOffer, this.expressOffer, this.productService, this.wbCard]) {
            try {
                count += await this.goodService.updateCountForSkus(service, skus);
            } catch (e) {
                this.logger.error(e.message, e);
            }
        }
        this.logger.log(`Update quantity for ${count} goods`);
    }
}
