import { Test, TestingModule } from '@nestjs/testing';
import { WbCardService } from './wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ConfigService } from '@nestjs/config';

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
            '/content/v2/get/cards/list',
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
            '/content/v2/get/cards/list',
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
        });
        expect(res).toEqual([testCard, testCard, testCard]);
    });
});
