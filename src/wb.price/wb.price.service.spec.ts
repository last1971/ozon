import { Test, TestingModule } from '@nestjs/testing';
import { WbPriceService } from './wb.price.service';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbPriceCoeffsAdapter } from './wb.price.coeffs.adapter';

describe('WbPriceService', () => {
    let service: WbPriceService;
    const getWbData = jest.fn();
    const getGoodIds = jest.fn();
    const updatePriceForService = jest.fn();
    const method = jest.fn();
    const getCardsByVendorCodes = jest.fn();
    const setWbData = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbPriceService,
                {
                    provide: ConfigService,
                    useValue: { get: () => 0 },
                },
                {
                    provide: GOOD_SERVICE,
                    useValue: { getWbData, updatePriceForService, setWbData },
                },
                {
                    provide: WbApiService,
                    useValue: { method },
                },
                {
                    provide: WbCardService,
                    useValue: { getGoodIds, getCardsByVendorCodes },
                },
            ],
        }).compile();

        method.mockClear();
        getWbData.mockClear();
        service = module.get<WbPriceService>(WbPriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('getObtainCoeffs', () => {
        const res = service.getObtainCoeffs();
        expect(res).toEqual({
            minMil: 0,
            percEkv: 0,
            percMil: 0,
            sumLabel: 0,
            sumObtain: 0,
        });
    });

    it('getProductsWithCoeffs', async () => {
        getWbData.mockResolvedValueOnce([{ id: '1', commission: 2, tariff: 3 }]);
        const res = await service.getProductsWithCoeffs(['1']);
        expect(res).toEqual([new WbPriceCoeffsAdapter({ id: '1', commission: 2, tariff: 3 })]);
    });

    it('updateAllPrices', async () => {
        getGoodIds.mockResolvedValueOnce({
            goods: new Map([[1, 2]]),
        });
        await service.updateAllPrices();
        expect(updatePriceForService.mock.calls[0]).toEqual([service, [1]]);
    });

    it('updateWbPrice', async () => {
        await service.updateWbPrice([{ nmId: 1, price: 2 }]);
        expect(method.mock.calls[0]).toEqual(['/public/api/v1/prices', 'post', [{ nmId: 1, price: 2 }]]);
    });

    it('updateWbPrice', async () => {
        await service.updateDiscounts([{ nm: 1, discount: 2 }]);
        expect(method.mock.calls[0]).toEqual(['/public/api/v1/updateDiscounts', 'post', [{ nm: 1, discount: 2 }]]);
    });

    it('updatePrices', async () => {
        getCardsByVendorCodes.mockResolvedValueOnce([
            {
                nmID: 1,
                vendorCode: '123',
                sizes: [],
            },
        ]);
        getWbData.mockResolvedValueOnce([{ id: '123', commission: 2, tariff: 3 }]);
        await service.updatePrices([
            { offer_id: '123', price: '2', old_price: '3', min_price: '1', incoming_price: 0.5, currency_code: 'RUB' },
        ]);
        expect(setWbData.mock.calls).toHaveLength(1);
        expect(setWbData.mock.calls[0]).toEqual([
            {
                commission: 2,
                id: '123',
                minPrice: '1',
                tariff: 3,
            },
            null,
        ]);
        expect(method.mock.calls[0]).toEqual(['/public/api/v1/prices', 'post', [{ nmId: 1, price: 3 }]]);
        expect(method.mock.calls[1]).toEqual(['/public/api/v1/updateDiscounts', 'post', [{ nm: 1, discount: 33 }]]);
    });
});
