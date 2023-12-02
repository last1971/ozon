import { Test, TestingModule } from '@nestjs/testing';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { ExpressOfferService } from '../yandex.offer/express.offer.service';
import { ProductService } from '../product/product.service';
import { WbCardService } from '../wb.card/wb.card.service';
import { ExtraGoodService } from './extra.good.service';
import { GoodServiceEnum } from './good.service.enum';

describe('ExtraGoodService', () => {
    let service: ExtraGoodService;
    const updateCountForService = jest.fn();
    const updateCountForSkus = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExtraGoodService,
                { provide: GOOD_SERVICE, useValue: { updateCountForService, updateCountForSkus } },
                { provide: YandexOfferService, useValue: { test: 'Yandex' } },
                { provide: ExpressOfferService, useValue: {} },
                { provide: ProductService, useValue: {} },
                { provide: WbCardService, useValue: {} },
            ],
        }).compile();

        updateCountForService.mockClear();
        updateCountForSkus.mockClear();
        service = module.get<ExtraGoodService>(ExtraGoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('updateService', async () => {
        await service.updateService(GoodServiceEnum.YANDEX);
        expect(updateCountForService.mock.calls[0]).toEqual([{ test: 'Yandex' }, '']);
    });

    it('test checkGoodCount', async () => {
        await service.checkGoodCount();
        expect(updateCountForService.mock.calls).toHaveLength(4);
    });

    it('reserveCreated', async () => {
        await service.reserveCreated(['1', '2']);
        expect(updateCountForSkus.mock.calls).toHaveLength(4);
    });

    it('serviceIsSwitchedOn', () => {
        const res = service.serviceIsSwitchedOn({ service: GoodServiceEnum.WB, isSwitchedOn: false });
        expect(res).toEqual({ isSuccess: true, message: 'Service wb is switched off' });
    });
});
