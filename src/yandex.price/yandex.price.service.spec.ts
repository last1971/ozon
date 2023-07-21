import { Test, TestingModule } from '@nestjs/testing';
import { YandexPriceService } from './yandex.price.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { PriceService } from '../price/price.service';

describe('YandexPriceService', () => {
    let service: YandexPriceService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                YandexPriceService,
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: YandexOfferService, useValue: {} },
                { provide: PriceService, useValue: {} },
            ],
        }).compile();

        service = module.get<YandexPriceService>(YandexPriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
