import { Test, TestingModule } from '@nestjs/testing';
import { GoodController } from './good.controller';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { ProductService } from '../product/product.service';
import { ExpressOfferService } from '../yandex.offer/express.offer.service';

describe('GoodController', () => {
    let controller: GoodController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [GoodController],
            providers: [
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: YandexOfferService, useValue: {} },
                { provide: ExpressOfferService, useValue: {} },
                { provide: ProductService, useValue: {} },
            ],
        }).compile();

        controller = module.get<GoodController>(GoodController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
