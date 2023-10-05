import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { ProductService } from './product/product.service';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';
import { WbCardService } from './wb.card/wb.card.service';

describe('Test App', () => {
    let service: AppService;
    const updateCountForService = jest.fn();
    const updateCountForSkus = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AppService,
                { provide: GOOD_SERVICE, useValue: { updateCountForService, updateCountForSkus } },
                { provide: ProductService, useValue: {} },
                { provide: YandexOfferService, useValue: {} },
                { provide: ExpressOfferService, useValue: {} },
                { provide: WbCardService, useValue: {} },
            ],
        }).compile();

        updateCountForService.mockClear();
        service = module.get<AppService>(AppService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test checkGoodCount', async () => {
        await service.checkGoodCount();
        expect(updateCountForService.mock.calls).toHaveLength(4);
    });

    it('reserveCreated', async () => {
        await service.reserveCreated(['1', '2']);
        expect(updateCountForSkus.mock.calls).toHaveLength(4);
    });
});
