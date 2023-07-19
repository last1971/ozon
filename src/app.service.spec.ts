import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { ProductService } from './product/product.service';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';

describe('Test App', () => {
    let service: AppService;
    const updateCountForService = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AppService,
                { provide: GOOD_SERVICE, useValue: { updateCountForService } },
                { provide: ProductService, useValue: {} },
                { provide: YandexOfferService, useValue: {} },
                { provide: ExpressOfferService, useValue: {} },
            ],
        }).compile();

        service = module.get<AppService>(AppService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test checkGoodCount', async () => {
        await service.checkGoodCount();
        expect(updateCountForService.mock.calls).toHaveLength(3);
    });
});
