import { Test, TestingModule } from "@nestjs/testing";
import { WbSupplyService } from "./wb.supply.service";
import { WbApiService } from "../wb.api/wb.api.service";
import { GoodServiceEnum } from "../good/good.service.enum";
import { HttpException } from "@nestjs/common";
import { WbOrderService } from "../wb.order/wb.order.service";

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
                {
                    provide:WbOrderService,
                    useValue: { getOrdersStickers: jest.fn() },
                }
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
            '/api/v3/supplies',
            'get',
            { limit: 1000, next: 0 },
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
            '/api/v3/supplies',
            'get',
            { limit: 1000, next: 0 },
        ]);
        expect(method.mock.calls[1]).toEqual([
            '/api/v3/supplies',
            'get',
            { limit: 1000, next: 1 },
        ]);
        expect(method.mock.calls[2]).toEqual([
            '/api/v3/supplies',
            'get',
            { limit: 1000, next: 2 },
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

    it('listOrderIds - success case', async () => {
        method.mockResolvedValueOnce({
            orderIds: [123456789, 987654321],
        });

        const res = await service.listOrderIds('WB-123');
        expect(method.mock.calls[0]).toEqual([
            '/api/marketplace/v3/supplies/WB-123/order-ids',
            'get',
            {},
        ]);
        expect(res).toEqual([123456789, 987654321]);
    });

    it('listOrderIds - empty response', async () => {
        method.mockResolvedValueOnce({});

        const res = await service.listOrderIds('WB-123');
        expect(res).toEqual([]);
    });

    it("getSupplyPositions - success case with orders and stickers", async () => {
        const mockListOrderIds = jest.spyOn(service, "listOrderIds").mockResolvedValue([123456789, 987654321]);

        const mockGetOrdersStickers = jest.spyOn(service["wbOrderService"], "getOrdersStickers").mockResolvedValue({
            stickers: [
                {
                    orderId: 123456789,
                    partA: 987654,
                    partB: 123321,
                    barcode: "ABC123456789",
                    file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAMACAIAAACzH0pGAAAAA"
                },
                {
                    orderId: 987654321,
                    partA: 123456,
                    partB: 654321,
                    barcode: "XYZ987654321",
                    file: "data:image/png;base64,aBAORw0KHgoAAAAASUhEUgOMSEyAAAUSDIIkGggAAAANS"
                },
            ],
            success: true,
            error: null
        });

        const res = await service.getSupplyPositions("supply-123");

        expect(mockListOrderIds).toHaveBeenCalledWith("supply-123");
        expect(mockGetOrdersStickers).toHaveBeenCalledWith([123456789, 987654321]);
        expect(res).toEqual([
            { supplyId: "supply-123", barCode: "ABC123456789", remark: "123456789", quantity: 1 },
            { supplyId: "supply-123", barCode: "XYZ987654321", remark: "987654321", quantity: 1 }
        ]);
    });

    it("getSupplyPositions - error in getOrdersStickers", async () => {
        jest.spyOn(service, "listOrderIds").mockResolvedValue([123456789, 987654321]);

        jest.spyOn(service["wbOrderService"], "getOrdersStickers").mockResolvedValue({
            stickers: [],
            success: false,
            error: "Failed to fetch stickers"
        });

        await expect(service.getSupplyPositions("supply-123")).rejects.toThrow(new HttpException("Failed to fetch stickers", 400));
    });

    it("getSupplyPositions - no orders returned", async () => {
        const mockListOrderIds = jest.spyOn(service, "listOrderIds").mockResolvedValue([]);

        const res = await service.getSupplyPositions("supply-123");

        expect(mockListOrderIds).toHaveBeenCalledWith("supply-123");
        expect(res).toEqual([]);
    });
});
