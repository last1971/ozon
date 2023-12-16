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
    const loadSkuList = jest.fn();
    const updateGoodCounts = jest.fn();
    const mockIn = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExtraGoodService,
                { provide: GOOD_SERVICE, useValue: { updateCountForService, updateCountForSkus, in: mockIn } },
                { provide: YandexOfferService, useValue: { test: 'Yandex', skuList: [] } },
                { provide: ExpressOfferService, useValue: { skuList: [] } },
                { provide: ProductService, useValue: { skuList: ['222'], updateGoodCounts } },
                { provide: WbCardService, useValue: { loadSkuList, skuList: ['111'], updateGoodCounts } },
            ],
        }).compile();

        updateCountForService.mockClear();
        updateCountForSkus.mockClear();
        updateGoodCounts.mockClear();
        service = module.get<ExtraGoodService>(ExtraGoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('updateService', async () => {
        await service.updateService(GoodServiceEnum.YANDEX);
        expect(updateCountForService.mock.calls[0]).toEqual([{ skuList: [], test: 'Yandex' }, '']);
    });

    it('test checkGoodCount', async () => {
        await service.checkGoodCount();
        expect(updateCountForService.mock.calls).toHaveLength(4);
    });

    it('reserveCreated', async () => {
        await service.reserveCreated(['1', '2']);
        expect(updateCountForSkus.mock.calls).toHaveLength(4);
    });

    it('serviceIsSwitchedOn', async () => {
        updateGoodCounts.mockResolvedValueOnce(1);
        const res = await service.serviceIsSwitchedOn({ service: GoodServiceEnum.WB, isSwitchedOn: false });
        expect(res).toEqual({ isSuccess: true, message: 'Service wb is switched off and reset 1 skus' });
        expect(updateGoodCounts.mock.calls[0]).toEqual([new Map<string, number>([['111', 0]])]);
    });

    it('loadSkuList', async () => {
        await service.loadSkuList(GoodServiceEnum.WB);
        await service.serviceIsSwitchedOn({ service: GoodServiceEnum.YANDEX, isSwitchedOn: false });
        await service.loadSkuList(GoodServiceEnum.YANDEX);
        expect(loadSkuList.mock.calls).toHaveLength(1);
    });

    it('countsChanged', async () => {
        await service.countsChanged([
            { code: '111', quantity: 10, reserve: 1 },
            { code: '222', quantity: 2, reserve: null },
        ]);
        expect(updateGoodCounts.mock.calls[0]).toEqual([new Map([['222', 2]])]);
        expect(updateGoodCounts.mock.calls[1]).toEqual([new Map([['111', 9]])]);
    });
});
