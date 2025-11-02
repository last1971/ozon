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
    const index = jest.fn();
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
                { provide: YandexOfferService, useValue: { getSkus, getShopSkus, index, campaignId: 12345 } },
                { provide: GOOD_SERVICE, useValue: { updatePriceForService } },
                { provide: YandexApiService, useValue: { method } },
                { provide: VaultService, useValue: {} },
            ],
        }).compile();

        method.mockClear();
        getSkus.mockClear();
        index.mockClear();
        service = module.get<YandexPriceService>(YandexPriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('getObtainCoeffs', () => {
        expect(service.getObtainCoeffs()).toEqual({
            minMil: 20,
            percMil: 5.5,
            sumLabel: 13,
            percEkv: 1,
            sumObtain: 25,
            taxUnit: 6,
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
                            purchasePrice: { currencyId: 'RUR', value: 30 },
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

    it('getDisountPrices', async () => {
        method.mockResolvedValueOnce({
            result: {
                offerMappings: [
                    { offer: { offerId: '123', purchasePrice: { value: 123 }, basicPrice: { discountBase: 223 } } },
                    { offer: { offerId: '321', purchasePrice: { value: 321 }, basicPrice: { discountBase: 421 } } },
                ],
            },
        });
        const res = await service.getDisountPrices(['123', '321']);
        expect(method.mock.calls[0]).toEqual([
            'businesses/undefined/offer-mappings',
            'post',
            { offerIds: ['123', '321'] },
        ]);
        expect(res).toEqual(
            new Map<string, number[]>([
                ['123', [123, 223]],
                ['321', [321, 421]],
            ]),
        );
    });

    describe('VAT methods', () => {
        it('vatToNumber should convert Yandex VAT IDs to percentages', () => {
            expect(service.vatToNumber(2)).toBe(10);   // 10%
            expect(service.vatToNumber(5)).toBe(0);    // 0%
            expect(service.vatToNumber(6)).toBe(-1);   // Не облагается
            expect(service.vatToNumber(7)).toBe(20);   // 20%
            expect(service.vatToNumber(10)).toBe(5);   // 5% (УСН)
            expect(service.vatToNumber(11)).toBe(7);   // 7% (УСН)
            expect(service.vatToNumber(999)).toBe(0);  // Unknown -> default 0
        });

        it('numberToVat should convert percentages to Yandex VAT IDs', () => {
            expect(service.numberToVat(10)).toBe('2');
            expect(service.numberToVat(0)).toBe('5');
            expect(service.numberToVat(-1)).toBe('6');
            expect(service.numberToVat(20)).toBe('7');
            expect(service.numberToVat(5)).toBe('10');
            expect(service.numberToVat(7)).toBe('11');
            expect(service.numberToVat(999)).toBe('7'); // Unknown -> default 7 (20%)
        });

        it('checkVatForAll should return mismatches', async () => {
            index.mockResolvedValueOnce({
                offers: [
                    { offerId: '123', campaignPrice: { vat: 10 } }, // 5% НДС
                    { offerId: '456', campaignPrice: { vat: 7 } },  // 20% НДС
                    { offerId: '789' },                              // Нет campaignPrice (считается как 0%)
                ],
                paging: {},
            });

            const result = await service.checkVatForAll(20, 100);

            expect(index).toHaveBeenCalledWith('', 100);
            expect(result).toEqual([
                { offer_id: '123', current_vat: 5, expected_vat: 20 },
                { offer_id: '789', current_vat: 0, expected_vat: 20 }, // undefined → 0%
            ]);
        });

        it('checkVatForAll should handle pagination', async () => {
            index
                .mockResolvedValueOnce({
                    offers: [{ offerId: '123', campaignPrice: { vat: 10 } }],
                    paging: { nextPageToken: 'token1' },
                })
                .mockResolvedValueOnce({
                    offers: [{ offerId: '456', campaignPrice: { vat: 5 } }],
                    paging: {},
                });

            const result = await service.checkVatForAll(20, 100);

            expect(index).toHaveBeenCalledTimes(2);
            expect(index).toHaveBeenNthCalledWith(1, '', 100);
            expect(index).toHaveBeenNthCalledWith(2, 'token1', 100);
            expect(result).toHaveLength(2);
        });

        it('updateVat should update VAT for offers', async () => {
            method.mockResolvedValueOnce({ status: 'OK' });

            const result = await service.updateVat(['123', '456'], 20);

            expect(method).toHaveBeenCalledWith(
                'v2/campaigns/12345/offers/update',
                'post',
                {
                    offers: [
                        { offerId: '123', vat: 7 },
                        { offerId: '456', vat: 7 },
                    ],
                }
            );
            expect(result).toEqual({ status: 'OK' });
        });

        it('updateVat should chunk large offer lists', async () => {
            method.mockResolvedValue({ status: 'OK' });

            const offerIds = Array.from({ length: 750 }, (_, i) => `offer-${i}`);
            const result = await service.updateVat(offerIds, 0);

            expect(method).toHaveBeenCalledTimes(2); // 500 + 250
            expect(method.mock.calls[0][2].offers).toHaveLength(500);
            expect(method.mock.calls[1][2].offers).toHaveLength(250);
            expect(result).toEqual({ results: [{ status: 'OK' }, { status: 'OK' }], totalUpdated: 750 });
        });
    });
});
