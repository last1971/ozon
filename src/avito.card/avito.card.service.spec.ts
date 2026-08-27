import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AvitoCardService } from './avito.card.service';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { AVITO_GOOD_STORE } from '../interfaces/i.avito.good.store';
import { AvitoLinkMaintenanceService } from './avito.link.maintenance.service';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('AvitoCardService', () => {
    let service: AvitoCardService;
    let avitoApiService: jest.Mocked<AvitoApiService>;
    let store: any;
    let maintenance: any;
    let configService: jest.Mocked<ConfigService>;

    beforeEach(async () => {
        const mockAvitoApi = {
            request: jest.fn(),
            getItemStatus: jest.fn(),
        };

        const mockStore = {
            getAllAvitoGoods: jest.fn(),
            disableAvitoGoods: jest.fn(),
        };

        const mockMaintenance = {
            disableDeadLinks: jest
                .fn()
                .mockImplementation(async (links: Array<{ id: string }>) => links.map((link) => link.id)),
        };

        const mockConfigService = {
            get: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AvitoCardService,
                { provide: AvitoApiService, useValue: mockAvitoApi },
                { provide: AVITO_GOOD_STORE, useValue: mockStore },
                { provide: AvitoLinkMaintenanceService, useValue: mockMaintenance },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<AvitoCardService>(AvitoCardService);
        avitoApiService = module.get(AvitoApiService);
        store = module.get(AVITO_GOOD_STORE);
        maintenance = module.get(AvitoLinkMaintenanceService);
        configService = module.get(ConfigService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getStock', () => {
        it('should call avito api with correct parameters', async () => {
            const mockResponse = {
                stocks: [
                    { item_id: 123, quantity: 5, is_out_of_stock: false, is_unlimited: false, is_multiple: true },
                    { item_id: 456, quantity: 0, is_out_of_stock: true, is_unlimited: false, is_multiple: false },
                ],
            };
            avitoApiService.request.mockResolvedValue(mockResponse);

            const result = await service.getStock([123, 456]);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [123, 456], strong_consistency: true },
                'post'
            );
            expect(result).toEqual(mockResponse);
        });

        it('should call avito api with custom strong_consistency', async () => {
            const mockResponse = { stocks: [] };
            avitoApiService.request.mockResolvedValue(mockResponse);

            await service.getStock([123], false);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [123], strong_consistency: false },
                'post'
            );
        });
    });

    describe('getGoodIds', () => {
        it('should return empty map when no avito ids exist', async () => {
            store.getAllAvitoGoods.mockResolvedValue([]);

            const result = await service.getGoodIds(null);

            expect(store.getAllAvitoGoods).toHaveBeenCalled();
            expect(result).toEqual({
                goods: new Map(),
                nextArgs: null,
            });
        });

        it('should process avito ids and return quantities', async () => {
            store.getAllAvitoGoods.mockResolvedValue([
                { id: '123', goodsCode: '456', coeff: 1, commission: 10.0 },
                { id: '456', goodsCode: '789', coeff: 1, commission: 10.0 },
                { id: '789', goodsCode: '101', coeff: 1, commission: 10.0 },
            ]);
            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, quantity: 5, is_out_of_stock: false, is_unlimited: false, is_multiple: true },
                    { item_id: 456, quantity: 0, is_out_of_stock: true, is_unlimited: false, is_multiple: false },
                    { item_id: 789, quantity: 10, is_out_of_stock: false, is_unlimited: true, is_multiple: true },
                ],
            });

            const result = await service.getGoodIds(null);

            expect(store.getAllAvitoGoods).toHaveBeenCalled();
            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [123, 456, 789], strong_consistency: true },
                'post'
            );

            const expectedMap = new Map([
                ['456', 5],
                ['101', 999999], 
                ['789', 0],
            ]);
            expect(result.goods).toEqual(expectedMap);
            expect(result.nextArgs).toBeNull();
        });

        it('should handle chunking for large number of ids', async () => {
            const largeIdArray = Array.from({ length: 25 }, (_, i) => ({
                id: (i + 1).toString(),
                goodsCode: `goods${i + 1}`,
                coeff: 1,
                commission: 10.0
            }));
            store.getAllAvitoGoods.mockResolvedValue(largeIdArray);

            avitoApiService.request
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 10 }, (_, i) => ({
                        item_id: i + 1,
                        quantity: (i + 1) * 10,
                        is_out_of_stock: false,
                        is_unlimited: false,
                        is_multiple: true,
                    })),
                })
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 10 }, (_, i) => ({
                        item_id: i + 11,
                        quantity: (i + 11) * 10,
                        is_out_of_stock: false,
                        is_unlimited: false,
                        is_multiple: true,
                    })),
                })
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 5 }, (_, i) => ({
                        item_id: i + 21,
                        quantity: (i + 21) * 10,
                        is_out_of_stock: false,
                        is_unlimited: false,
                        is_multiple: true,
                    })),
                });

            const result = await service.getGoodIds(null);

            expect(avitoApiService.request).toHaveBeenCalledTimes(3);
            expect(result.goods.size).toBe(25);
            expect(result.goods.get('goods1')).toBe(10);
            expect(result.goods.get('goods25')).toBe(250);
        });
    });

    describe('updateGoodCounts', () => {
        beforeEach(() => {
            // Setup skuAvitoIdPair for testing
            service['skuAvitoIdPair'].set('goods1', '123');
            service['skuAvitoIdPair'].set('goods2', '456');
        });

        it('should return 0 when goods map is empty', async () => {
            const result = await service.updateGoodCounts(new Map());
            expect(result).toBe(0);
            expect(avitoApiService.request).not.toHaveBeenCalled();
        });

        it('should update stocks via API and return success count', async () => {
            const goods = new Map([
                ['goods1', 10],
                ['goods2', 20]
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null },
                    { item_id: 456, success: true, errors: [], external_id: null }
                ]
            });

            const result = await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/stocks',
                {
                    stocks: [
                        { item_id: 123, quantity: 10 },
                        { item_id: 456, quantity: 20 }
                    ]
                },
                'put'
            );
            expect(result).toBe(2);
        });

        it('should handle partial success responses', async () => {
            const goods = new Map([
                ['goods1', 10],
                ['goods2', 20]
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null },
                    { item_id: 456, success: false, errors: ['Some error'], external_id: null }
                ]
            });

            const result = await service.updateGoodCounts(goods);

            expect(result).toBe(1); // Only one successful
        });

        it('should limit quantities to 999999', async () => {
            const goods = new Map([
                ['goods1', 1000000] // Exceeds limit
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null }
                ]
            });

            await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/stocks',
                {
                    stocks: [
                        { item_id: 123, quantity: 999999 }
                    ]
                },
                'put'
            );
        });

        it('should handle chunking for large updates', async () => {
            // Create 250 goods
            const goods = new Map();
            for (let i = 1; i <= 250; i++) {
                goods.set(`goods${i}`, i);
                service['skuAvitoIdPair'].set(`goods${i}`, i.toString());
            }

            avitoApiService.request
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 200 }, (_, i) => ({
                        item_id: i + 1,
                        success: true,
                        errors: [],
                        external_id: null
                    }))
                })
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 50 }, (_, i) => ({
                        item_id: i + 201,
                        success: true,
                        errors: [],
                        external_id: null
                    }))
                });

            const result = await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledTimes(2);
            expect(result).toBe(250);
        });

        it('should handle API errors gracefully', async () => {
            const goods = new Map([['goods1', 10]]);

            avitoApiService.request.mockRejectedValue(new Error('API Error'));

            const result = await service.updateGoodCounts(goods);

            expect(result).toBe(0); // No successful updates due to error
        });

        it('should skip goods without valid Avito IDs', async () => {
            const goods = new Map([
                ['goods1', 10],        // Has valid ID
                ['unknown', 20]        // No ID mapping
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null }
                ]
            });

            const result = await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/stocks',
                {
                    stocks: [
                        { item_id: 123, quantity: 10 }
                        // 'unknown' should be filtered out
                    ]
                },
                'put'
            );
            expect(result).toBe(1);
        });
    });

    describe('getGoodIds: битые объявления', () => {
        const goods = (count: number, from = 1) =>
            Array.from({ length: count }, (_, i) => ({
                id: (from + i).toString(),
                goodsCode: `goods${from + i}`,
                coeff: 1,
                commission: 10.0,
            }));
        const stock = (id: number, quantity: number) => ({
            item_id: id,
            quantity,
            is_out_of_stock: false,
            is_unlimited: false,
            is_multiple: true,
        });

        it('перебирает пачку поштучно и не теряет живые позиции', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(10));
            avitoApiService.request.mockImplementation(async (_url, options: any) => {
                const ids: number[] = options.item_ids;
                if (ids.length > 1) throw new Error('400');
                if (ids[0] === 5) throw new Error('400');
                return { stocks: [stock(ids[0], ids[0] * 10)] };
            });

            const result = await service.getGoodIds(null);

            expect(result.goods.size).toBe(9);
            expect(result.goods.get('goods1')).toBe(10);
            expect(result.goods.has('goods5')).toBe(false);
        });

        it('после падения пачки продолжает со следующей', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(20));
            avitoApiService.request.mockImplementation(async (_url, options: any) => {
                const ids: number[] = options.item_ids;
                if (ids.includes(3) && ids.length > 1) throw new Error('400');
                if (ids[0] === 3) throw new Error('400');
                return { stocks: ids.map((id) => stock(id, id * 10)) };
            });

            const result = await service.getGoodIds(null);

            expect(result.goods.size).toBe(19);
            expect(result.goods.get('goods20')).toBe(200);
        });

        it('передаёт упавшие привязки в обслуживание справочника', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(10));
            avitoApiService.request.mockImplementation(async (_url, options: any) => {
                const ids: number[] = options.item_ids;
                if (ids.includes(2)) throw new Error('400');
                return { stocks: ids.map((id) => stock(id, 1)) };
            });

            await service.getGoodIds(null);

            expect(maintenance.disableDeadLinks).toHaveBeenCalledWith([
                expect.objectContaining({ id: '2' }),
            ]);
        });

        it('необъяснённый провал (объявление живо) роняет прогон', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(10));
            avitoApiService.request.mockImplementation(async (_url, options: any) => {
                const ids: number[] = options.item_ids;
                if (ids.includes(5)) throw new Error('429');
                return { stocks: ids.map((id) => stock(id, id * 10)) };
            });
            maintenance.disableDeadLinks.mockResolvedValue([]); // статус не removed — привязка сохранена

            await expect(service.getGoodIds(null)).rejects.toThrow('прогон не засчитан');
        });

        it('порог из конфига позволяет пережить единичный необъяснённый провал', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(10));
            configService.get.mockReturnValue(0.2);
            avitoApiService.request.mockImplementation(async (_url, options: any) => {
                const ids: number[] = options.item_ids;
                if (ids.includes(5)) throw new Error('429');
                return { stocks: ids.map((id) => stock(id, id * 10)) };
            });
            maintenance.disableDeadLinks.mockResolvedValue([]);

            const result = await service.getGoodIds(null);

            expect(result.goods.size).toBe(9);
        });

        it('мусорный AVITO_FAIL_RATIO не ослабляет порог', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(10));
            configService.get.mockReturnValue('');
            avitoApiService.request.mockImplementation(async (_url, options: any) => {
                const ids: number[] = options.item_ids;
                if (ids.includes(5)) throw new Error('429');
                return { stocks: ids.map((id) => stock(id, id * 10)) };
            });
            maintenance.disableDeadLinks.mockResolvedValue([]);

            await expect(service.getGoodIds(null)).rejects.toThrow('прогон не засчитан');
        });

        it('справочник не пуст, но все id нечисловые — авария', async () => {
            store.getAllAvitoGoods.mockResolvedValue([
                { id: 'avito1', goodsCode: 'goodsA', coeff: 1, commission: 10 },
            ]);

            await expect(service.getGoodIds(null)).rejects.toThrow('не пригоден для запроса');
            expect(avitoApiService.request).not.toHaveBeenCalled();
        });

        it('пары sku↔id не пропадают на время прогона', async () => {
            store.getAllAvitoGoods.mockResolvedValueOnce(goods(1));
            avitoApiService.request.mockResolvedValueOnce({ stocks: [stock(1, 5)] });
            await service.getGoodIds(null);

            store.getAllAvitoGoods.mockResolvedValueOnce(goods(1));
            avitoApiService.request.mockImplementationOnce(async () => {
                // во время следующего прогона прежняя пара обязана оставаться видимой
                expect(service.getAvitoId('goods1')).toBe('1');
                return { stocks: [stock(1, 6)] };
            });

            await service.getGoodIds(null);
            expect(service.getAvitoId('goods1')).toBe('1');
        });

        it('массовый отвал остаётся аварией — бросает наружу', async () => {
            store.getAllAvitoGoods.mockResolvedValue(goods(10));
            avitoApiService.request.mockRejectedValue(new Error('400'));
            maintenance.disableDeadLinks.mockResolvedValue([]);

            await expect(service.getGoodIds(null)).rejects.toThrow('прогон не засчитан');
        });

        it('не тащит sku прошлого прогона', async () => {
            store.getAllAvitoGoods.mockResolvedValueOnce(goods(1));
            avitoApiService.request.mockResolvedValueOnce({ stocks: [stock(1, 5)] });
            await service.getGoodIds(null);
            expect(service.getAvitoId('goods1')).toBe('1');

            store.getAllAvitoGoods.mockResolvedValueOnce(goods(1, 2));
            avitoApiService.request.mockResolvedValueOnce({ stocks: [stock(2, 5)] });
            await service.getGoodIds(null);

            expect(service.getAvitoId('goods1')).toBeUndefined();
            expect(service.getAvitoId('goods2')).toBe('2');
        });

        it('нечисловой id в API не уходит и привязку не теряет', async () => {
            store.getAllAvitoGoods.mockResolvedValue([
                { id: 'avito123', goodsCode: 'goodsX', coeff: 1, commission: 10.0 },
                ...goods(1),
            ]);
            avitoApiService.request.mockResolvedValue({ stocks: [stock(1, 7)] });

            const result = await service.getGoodIds(null);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [1], strong_consistency: true },
                'post',
            );
            expect(result.goods.get('goods1')).toBe(7);
            expect(maintenance.disableDeadLinks).not.toHaveBeenCalled();
        });
    });
});