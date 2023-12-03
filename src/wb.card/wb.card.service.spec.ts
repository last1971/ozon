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
                data: {
                    cards: [
                        {
                            nmID: 1,
                            vendorCode: '1',
                            sizes: [
                                {
                                    skus: ['1-1'],
                                },
                            ],
                        },
                    ],
                    cursor: { total: 1 },
                },
            })
            .mockResolvedValueOnce({ stocks: [{ sku: '1-1', amount: 10 }] });
        const res = await service.getGoodIds('');
        expect(res).toEqual({ goods: new Map([['1', 10]]), nextArgs: null });
        expect(method.mock.calls).toHaveLength(2);
        expect(method.mock.calls[0]).toEqual([
            '/content/v1/cards/cursor/list',
            'post',
            {
                sort: {
                    cursor: {
                        limit: 1000,
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
                },
                {
                    nmID: 2,
                    vendorCode: '2',
                    sizes: [
                        {
                            skus: ['1-2'],
                        },
                    ],
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
        expect(res).toEqual(2);
        expect(method.mock.calls).toHaveLength(2);
        expect(method.mock.calls[0]).toEqual([
            '/content/v1/cards/filter',
            'post',
            {
                vendorCodes: ['1', '2', '3'],
            },
        ]);
        expect(method.mock.calls[1]).toEqual([
            '/api/v3/stocks/undefined',
            'put',
            {
                stocks: [
                    { amount: 1, sku: '1-1' },
                    { amount: 2, sku: '1-2' },
                ],
            },
        ]);
    });
});
