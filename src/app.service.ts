import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from "@nestjs/schedule";
import { ProductService } from './product/product.service';
import { GOOD_SERVICE, IGood } from './interfaces/IGood';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';
import { OnEvent } from '@nestjs/event-emitter';
import { WbCardService } from './wb.card/wb.card.service';
import Firebird, { attach, Database, Options, SupportedCharacterSet } from "node-firebird";
import { ConfigService } from "@nestjs/config";
import { promisify } from "util";

@Injectable()
export class AppService {
    private logger = new Logger(AppService.name);
    constructor(
        private productService: ProductService,
        private yandexOffer: YandexOfferService,
        private expressOffer: ExpressOfferService,
        private wbCard: WbCardService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
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
    @Timeout(0)
    async test(): Promise<void> {
        const configService = this.configService;
        const host = configService.get<string>('FB_HOST');
        if (!host) return null;
        const options: Options = {
            host,
            port: configService.get<number>('FB_PORT', 3050),
            database: configService.get<string>('FB_BASE', '/var/lib/firebird/2.5/data/base.fdb'),
            user: configService.get<string>('FB_USER', 'SYSDBA'),
            password: configService.get<string>('FB_PASS', '123456'),
            encoding: configService.get<SupportedCharacterSet>('FB_ENCD', 'UTF8'),
            retryConnectionInterval: 1000, // reconnect interval in case of connection drop
        };
        const db = await promisify<Options, Database>(attach)(options);
        const asyncTransaction = promisify(db.transaction);
        const transaction = await asyncTransaction.call(db, Firebird.ISOLATION_READ_COMMITTED);
        const asyncQuery = promisify(transaction.query);
        await asyncQuery.call(transaction, 'SELECT * FROM WILDBERRIES', []);
        await asyncQuery.call(transaction, 'SELECT * FROM WILDBERRIES WHERE ID = ?', ['1']);
        const asyncRollback = promisify(transaction.rollback);
        await asyncRollback.call(transaction);
        db.detach();
    }
}
