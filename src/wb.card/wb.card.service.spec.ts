import { Test, TestingModule } from '@nestjs/testing';
import { WbCardService } from './wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ConfigService } from '@nestjs/config';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';

describe('WbCardService', () => {
    let service: WbCardService;
    const method = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbCardService,
                {
                    provide: WbApiService,
                    useValue: { method },
                },
                {
                    provide: VaultService,
                    useValue: { get: () => ({ WAREHOUSE_ID: 12345 }) },
                },
                { provide: ConfigService, useValue: {} },
            ],
        }).compile();

        method.mockClear();
        clearRateLimitCache();
        service = module.get<WbCardService>(WbCardService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('getGoodIds', async () => {
        method
            .mockResolvedValueOnce({
                cards: [
                    {
                        nmID: 1,
                        vendorCode: '1',
                        sizes: [
                            {
                                skus: ['1-1'],
                            },
                        ],
                        photos:[{ big: 'test.jpg' }],
                    },
                ],
                cursor: { total: 1 },
            })
            .mockResolvedValueOnce({ stocks: [{ sku: '1-1', amount: 10 }] });
        const res = await service.getGoodIds('');
        expect(res).toEqual({ goods: new Map([['1', 10]]), nextArgs: null });
        expect(method.mock.calls).toHaveLength(2);
        expect(method.mock.calls[0]).toEqual([
            'https://content-api.wildberries.ru/content/v2/get/cards/list',
            'post',
            {
                settings: {
                    cursor: {
                        limit: 100,
                    },
                    filter: {
                        withPhoto: -1,
                    },
                },
            },
            true,
        ]);
        expect(method.mock.calls[1]).toEqual(['/api/v3/stocks/undefined', 'post', { skus: ['1-1'] }]);
    });

    it('updateGoodCounts', async () => {
        method
            .mockResolvedValueOnce({
                cards: [
                    {
                        nmID: 1,
                        vendorCode: '1',
                        sizes: [
                            {
                                skus: ['1-1'],
                            },
                        ],
                        photos:[{ big: 'test.jpg' }],
                    },
                ],
                cursor: { total: 1 },
            })
            .mockResolvedValueOnce({ stocks: [{ sku: '1-1', amount: 10 }] });
        await service.getGoodIds('');
        method.mockResolvedValueOnce({
            data: [
                {
                    nmID: 1,
                    vendorCode: '1',
                    sizes: [
                        {
                            skus: ['1-1'],
                        },
                    ],
                    photos:[{ big: 'test.jpg' }],
                },
                {
                    nmID: 2,
                    vendorCode: '2',
                    sizes: [
                        {
                            skus: ['1-2'],
                        },
                    ],
                    photos:[{ big: 'test.jpg' }],
                },
            ],
        });
        const res = await service.updateGoodCounts(
            new Map([
                ['1', 1],
                ['2', 2],
                ['3', 3],
            ]),
        );
        expect(res).toEqual(1);
        expect(method.mock.calls).toHaveLength(3);
        expect(method.mock.calls[2]).toEqual([
            '/api/v3/stocks/undefined',
            'put',
            {
                stocks: [{ amount: 1, sku: '1-1' }],
            },
        ]);
    });
    it('getWbCards', async () => {
        method.mockResolvedValueOnce({
            cards: [],
            cursor: { total: 0 },
        });
        await service.getWbCards('');
        expect(method.mock.calls[0]).toEqual([
            'https://content-api.wildberries.ru/content/v2/get/cards/list',
            'post',
            {
                settings: {
                    cursor: {
                        limit: 100,
                    },
                    filter: {
                        withPhoto: -1,
                    },
                },
            },
            true,
        ]);
    });
    it('getAllWbCards', async () => {
        const testCard = {
                nmID: 1,
                vendorCode: '1',
                sizes: [
                    {
                        skus: ['1-1'],
                    },
                ],
                photos:[{ big: 'test.jpg' }],
                title: 'test-name'
            };
        method
            .mockResolvedValueOnce({
                cards: [testCard],
                cursor: { total: 100 },
            })
            .mockResolvedValueOnce({
                cards: [testCard, testCard],
                cursor: { total: 3 },
            });
        const res = await service.getAllWbCards();
        const productInfos = Reflect.get(service, 'productInfos').get('1');
        expect(productInfos).toEqual({
            barCode: '1-1',
            goodService: 'wb',
            id: '1',
            primaryImage: 'test.jpg',
            remark: 'test-name',
            sku: '1',
            fbsCount: 0,
            fboCount: 0,
        });
        expect(res).toEqual([testCard, testCard, testCard]);
    });

    describe('wbCards cache', () => {
        it('getWbCard should return card from cache', async () => {
            const testCard = {
                nmID: 1,
                vendorCode: 'test-sku',
                sizes: [{ skus: ['1-1'] }],
                photos: [{ big: 'test.jpg' }],
                title: 'test-name',
            };

            method.mockResolvedValueOnce({
                cards: [testCard],
                cursor: { total: 1 },
            });

            await service.getAllWbCards();
            const result = service.getWbCard('test-sku');

            expect(result).toEqual(testCard);
        });

        it('getWbCard should return null if card not in cache', () => {
            const result = service.getWbCard('non-existent');
            expect(result).toBeNull();
        });

        it('getWbCardAsync should return card from cache if exists', async () => {
            const testCard = {
                nmID: 1,
                vendorCode: 'test-sku',
                sizes: [{ skus: ['1-1'] }],
                photos: [{ big: 'test.jpg' }],
                title: 'test-name',
            };

            method.mockResolvedValueOnce({
                cards: [testCard],
                cursor: { total: 1 },
            });

            await service.getAllWbCards();
            const result = await service.getWbCardAsync('test-sku');

            expect(result).toEqual(testCard);
            expect(method).toHaveBeenCalledTimes(1); // Only the initial getAllWbCards call
        });

        it('getWbCardAsync should fetch all cards if not in cache', async () => {
            const testCard = {
                nmID: 1,
                vendorCode: 'test-sku',
                sizes: [{ skus: ['1-1'] }],
                photos: [{ big: 'test.jpg' }],
                title: 'test-name',
            };

            method.mockResolvedValueOnce({
                cards: [testCard],
                cursor: { total: 1 },
            });

            const result = await service.getWbCardAsync('test-sku');

            expect(result).toEqual(testCard);
            expect(method).toHaveBeenCalledTimes(1);
        });

        it('getWbCardAsync should return null if card not found after fetching', async () => {
            method.mockResolvedValueOnce({
                cards: [],
                cursor: { total: 0 },
            });

            const result = await service.getWbCardAsync('non-existent');

            expect(result).toBeNull();
        });

        it('clearWbCards should clear the cache', async () => {
            const testCard = {
                nmID: 1,
                vendorCode: 'test-sku',
                sizes: [{ skus: ['1-1'] }],
                photos: [{ big: 'test.jpg' }],
                title: 'test-name',
            };

            method.mockResolvedValueOnce({
                cards: [testCard],
                cursor: { total: 1 },
            });

            await service.getAllWbCards();
            expect(service.getWbCard('test-sku')).toEqual(testCard);

            service.clearWbCards();
            expect(service.getWbCard('test-sku')).toBeNull();
        });
    });

    describe('updateCards', () => {
        it('should update cards in single request if less than 1000', async () => {
            const cards = Array.from({ length: 100 }, (_, i) => ({
                nmID: i + 1,
                vendorCode: `sku-${i}`,
                subjectID: 100,
                subjectName: 'Test Subject',
                sizes: [{ skus: [`${i}-1`] }],
                photos: [{ big: 'test.jpg' }],
                title: `test-${i}`,
            }));

            method.mockResolvedValueOnce({ success: true });

            await service.updateCards(cards);

            expect(method).toHaveBeenCalledTimes(1);
            expect(method).toHaveBeenCalledWith(
                'https://content-api.wildberries.ru/content/v2/cards/update',
                'post',
                cards,
                true
            );
        });

        it('should chunk cards if more than 1000', async () => {
            const cards = Array.from({ length: 2500 }, (_, i) => ({
                nmID: i + 1,
                vendorCode: `sku-${i}`,
                subjectID: 100,
                subjectName: 'Test Subject',
                sizes: [{ skus: [`${i}-1`] }],
                photos: [{ big: 'test.jpg' }],
                title: `test-${i}`,
            }));

            method
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: true });

            const result = await service.updateCards(cards);

            expect(method).toHaveBeenCalledTimes(3);
            expect(result).toHaveLength(3);
            expect(method.mock.calls[0][2]).toHaveLength(1000);
            expect(method.mock.calls[1][2]).toHaveLength(1000);
            expect(method.mock.calls[2][2]).toHaveLength(500);
        });

        it('should return empty array if no cards provided', async () => {
            method.mockClear(); // Очищаем моки от предыдущих тестов
            const result = await service.updateCards([]);
            expect(result).toEqual([]);
            expect(method).not.toHaveBeenCalled();
        });
    });
});
