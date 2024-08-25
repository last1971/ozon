import { Test, TestingModule } from '@nestjs/testing';
import { WbSupplyService } from './wb.supply.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('WbSupplyService', () => {
    let service: WbSupplyService;

    const method = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbSupplyService,
                {
                    provide: WbApiService,
                    useValue: { method },
                },
            ],
        }).compile();

        method.mockClear();
        service = module.get<WbSupplyService>(WbSupplyService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('list', async () => {
        method.mockResolvedValueOnce({
            supplies: [{ id: 123 }],
            next: 123,
        });
        const res = await service.list();
        expect(method.mock.calls[0]).toEqual([
            'https://marketplace-api.wildberries.ru/api/v3/supplies',
            'get',
            { limit: 1000, next: 0 },
            true,
        ]);
        expect(res).toEqual([{ id: 123 }]);
    });

    it('updateSupplies', async () => {
        method
            .mockResolvedValueOnce({ supplies: [{ id: 1 }], next: 1 })
            .mockResolvedValueOnce({ supplies: [{ id: 2 }], next: 2 })
            .mockResolvedValueOnce({ supplies: [], next: 3 });
        await service.updateSupplies();
        expect(method.mock.calls).toHaveLength(3);
        expect(method.mock.calls[0]).toEqual([
            'https://marketplace-api.wildberries.ru/api/v3/supplies',
            'get',
            { limit: 1000, next: 0 },
            true,
        ]);
        expect(method.mock.calls[1]).toEqual([
            'https://marketplace-api.wildberries.ru/api/v3/supplies',
            'get',
            { limit: 1000, next: 1 },
            true,
        ]);
        expect(method.mock.calls[2]).toEqual([
            'https://marketplace-api.wildberries.ru/api/v3/supplies',
            'get',
            { limit: 1000, next: 2 },
            true,
        ]);
    });

    it('getSupplies', async () => {
        method
            .mockResolvedValueOnce({
                supplies: [
                    { id: 'WB-123', name: 'test123', done: false },
                    { id: 'WB-124', name: 'test124', done: true },
                ],
                next: 1,
            })
            .mockResolvedValueOnce({ supplies: [], next: 2 });
        const res = await service.getSupplies();
        expect(res).toEqual([
            { goodService: GoodServiceEnum.WB, id: 'WB-123', remark: 'test123', isMarketplace: true },
        ]);
    });
});
