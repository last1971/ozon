import { Test, TestingModule } from '@nestjs/testing';
import { YandexPriceService } from './yandex.price.service';
import { ConfigService } from '@nestjs/config';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { YandexProductCoeffsAdapter } from './yandex.product.coeffs.adapter';
import { AutoAction } from '../price/dto/update.price.dto';

describe('YandexPriceService', () => {
    let service: YandexPriceService;
    const getSkus = jest.fn().mockResolvedValue({ shopSkus: [{}] });
    const getShopSkus = jest.fn().mockResolvedValue({ goods: new Map([['123', 123]]) });
    const method = jest.fn();
    const updatePrice = {
        auto_action_enabled: AutoAction.DISABLED,
        price_strategy_enabled: AutoAction.DISABLED,
        incoming_price: 20,
        min_price: '30',
        price: '40',
        old_price: '50',
        product_id: 1,
        offer_id: '1',
        currency_code: 'RUB',
    };
    const updatePriceForService = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                YandexPriceService,
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, defaultValue: any) => {
                            switch (key) {
                                case 'YANDEX_MIN_MIL':
                                    return 20;
                                case 'PERC_MIL':
                                    return 5.5;
                                case 'SUM_PACK':
                                    return 10;
                                default:
                                    return defaultValue;
                            }
                        },
                    },
                },
                { provide: YandexOfferService, useValue: { getSkus, getShopSkus } },
                { provide: GOOD_SERVICE, useValue: { updatePriceForService } },
                { provide: YandexApiService, useValue: { method } },
                { provide: VaultService, useValue: {} },
            ],
        }).compile();

        method.mockClear();
        getSkus.mockClear();
        service = module.get<YandexPriceService>(YandexPriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('getObtainCoeffs', () => {
        expect(service.getObtainCoeffs()).toEqual({
            minMil: 20,
            percMil: 5.5,
            percEkv: 1,
            sumObtain: 25,
            sumPack: 10,
        });
    });

    it('getProductsWithCoeffs', async () => {
        const res = await service.getProductsWithCoeffs(['1']);
        expect(res[0]).toBeInstanceOf(YandexProductCoeffsAdapter);
        expect(getSkus.mock.calls[0]).toEqual([['1']]);
    });

    it('updatePrices', async () => {
        await service.updatePrices([updatePrice]);
        expect(method.mock.calls).toHaveLength(2);
    });

    it('updateIncomingPrices', async () => {
        await service.updateIncomingPrices([updatePrice]);
        expect(method.mock.calls[0]).toEqual([
            'businesses/undefined/offer-mappings/update',
            'post',
            {
                offerMappings: [
                    {
                        offer: {
                            additionalExpenses: { currencyId: 'RUR', value: 25 },
                            cofinancePrice: { currencyId: 'RUR', value: 30 },
                            offerId: '1',
                            purchasePrice: { currencyId: 'RUR', value: 20 },
                        },
                    },
                ],
            },
        ]);
    });

    it('updateOfferPrices', async () => {
        await service.updateOfferPrices([updatePrice]);
        expect(method.mock.calls[0]).toEqual([
            'businesses/undefined/offer-prices/updates',
            'post',
            {
                offers: [
                    {
                        offerId: '1',
                        price: {
                            currencyId: 'RUR',
                            discountBase: 50,
                            value: 40,
                        },
                    },
                ],
            },
        ]);
    });

    it('updateAllPrices', async () => {
        await service.updateAllPrices();
        expect(getShopSkus.mock.calls[0]).toEqual(['']);
        expect(updatePriceForService.mock.calls[0]).toEqual([service, ['123']]);
    });
});
