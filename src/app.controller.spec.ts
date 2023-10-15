import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { ProductService } from './product/product.service';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';
import { WbCardService } from './wb.card/wb.card.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
    let appController: AppController;

    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            controllers: [AppController],
            providers: [
                AppService,
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: ProductService, useValue: {} },
                { provide: YandexOfferService, useValue: {} },
                { provide: ExpressOfferService, useValue: {} },
                { provide: WbCardService, useValue: {} },
                { provide: ConfigService, useValue: {} },
            ],
        }).compile();

        appController = app.get<AppController>(AppController);
    });

    describe('root', () => {
        it('should return "Hello World!"', () => {
            expect(appController.getHello()).toBe('Hello World!');
        });
    });
});
