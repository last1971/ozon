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

    // New tests for listOrders method
    it('listOrders - success case', async () => {
        method.mockResolvedValueOnce({
            orders: [{ id: 'order-1' }, { id: 'order-2' }],
        });

        const res = await service.listOrders('123');
        expect(method.mock.calls[0]).toEqual([
            'https://marketplace-api.wildberries.ru/api/v3/supplies/123/orders',
            'get',
            {},
            true,
        ]);
        expect(res).toEqual({
            orders: [{ id: 'order-1' }, { id: 'order-2' }],
            success: true,
            error: null,
        });
    });

    it('listOrders - error case', async () => {
        method.mockRejectedValueOnce(new Error('Request failed'));

        const res = await service.listOrders('123');
        expect(method.mock.calls[0]).toEqual([
            'https://marketplace-api.wildberries.ru/api/v3/supplies/123/orders',
            'get',
            {},
            true,
        ]);
        expect(res).toEqual({
            orders: [],
            success: false,
            error: 'Request failed',
        });
    });

    // New tests for getSupplyPositions method
    it("getSupplyPositions - success case with orders and stickers", async () => {
        const mockListOrders = jest.spyOn(service, "listOrders").mockResolvedValue({
            orders: [
                {
                    scanPrice: null,
                    orderUid: "123e4567-e89b-12d3-a456-426614174000",
                    article: "ABC-123",
                    colorCode: "RED123",
                    rid: "RID98765",
                    createdAt: "2023-10-25T14:23:00Z",
                    offices: ["Office1", "Office2"],
                    skus: ["SKU123", "SKU456"],
                    id: 123456789,
                    warehouseId: 5,
                    nmId: 78910234,
                    chrtId: 43210987,
                    price: 15000,
                    convertedPrice: 12500,
                    currencyCode: 840,
                    convertedCurrencyCode: 978,
                    cargoType: 1,
                    isZeroOrder: false,
                },
                {
                    scanPrice: null,
                    orderUid: "987e6543-e21b-54d3-b654-524614174111",
                    article: "DEF-456",
                    colorCode: "BLUE567",
                    rid: "RID12345",
                    createdAt: "2023-11-01T08:10:00Z",
                    offices: null, // Например, если данные отсутствуют
                    skus: ["SKU890"],
                    id: 987654321,
                    warehouseId: 10,
                    nmId: 65498732,
                    chrtId: 98765432,
                    price: 20000,
                    convertedPrice: 18000,
                    currencyCode: 978,
                    convertedCurrencyCode: 643,
                    cargoType: 2,
                    isZeroOrder: true,
                },
            ],
            success: true,
            error: null
        });

        const mockGetOrdersStickers = jest.spyOn(service["wbOrderService"], "getOrdersStickers").mockResolvedValue({
            stickers: [
                {
                    orderId: 123456789,
                    partA: 987654,
                    partB: 123321,
                    barcode: "ABC123456789",
                    file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAMACAIAAACzH0pGAAAAA" // Пример base64
                },
                {
                    orderId: 987654321,
                    partA: 123456,
                    partB: 654321,
                    barcode: "XYZ987654321",
                    file: "data:image/png;base64,aBAORw0KHgoAAAAASUhEUgOMSEyAAAUSDIIkGggAAAANS" // Пример base64
                },
            ],
            success: true,
            error: null
        });

        const res = await service.getSupplyPositions("supply-123");

        expect(mockListOrders).toHaveBeenCalledWith("supply-123");
        expect(mockGetOrdersStickers).toHaveBeenCalledWith([123456789, 987654321]);
        expect(res).toEqual([
            { supplyId: "supply-123", barCode: "ABC123456789", remark: "123456789", quantity: 1 },
            { supplyId: "supply-123", barCode: "XYZ987654321", remark: "987654321", quantity: 1 }
        ]);
    });

    it("getSupplyPositions - error in listOrders", async () => {
        const mockListOrders = jest.spyOn(service, "listOrders").mockResolvedValue({
            orders: [],
            success: false,
            error: "Failed to fetch orders"
        });

        await expect(service.getSupplyPositions("supply-123")).rejects.toThrow(new HttpException("Failed to fetch orders", 400));
        expect(mockListOrders).toHaveBeenCalledWith("supply-123");
    });


    it("getSupplyPositions - error in getOrdersStickers", async () => {
        const mockListOrders = jest.spyOn(service, "listOrders").mockResolvedValue({
            orders: [
                {
                    scanPrice: null,
                    orderUid: "123e4567-e89b-12d3-a456-426614174000",
                    article: "ABC-123",
                    colorCode: "RED123",
                    rid: "RID98765",
                    createdAt: "2023-10-25T14:23:00Z",
                    offices: ["Office1", "Office2"],
                    skus: ["SKU123", "SKU456"],
                    id: 123456789,
                    warehouseId: 5,
                    nmId: 78910234,
                    chrtId: 43210987,
                    price: 15000,
                    convertedPrice: 12500,
                    currencyCode: 840,
                    convertedCurrencyCode: 978,
                    cargoType: 1,
                    isZeroOrder: false,
                },
                {
                    scanPrice: null,
                    orderUid: "987e6543-e21b-54d3-b654-524614174111",
                    article: "DEF-456",
                    colorCode: "BLUE567",
                    rid: "RID12345",
                    createdAt: "2023-11-01T08:10:00Z",
                    offices: null, // Например, если данные отсутствуют
                    skus: ["SKU890"],
                    id: 987654321,
                    warehouseId: 10,
                    nmId: 65498732,
                    chrtId: 98765432,
                    price: 20000,
                    convertedPrice: 18000,
                    currencyCode: 978,
                    convertedCurrencyCode: 643,
                    cargoType: 2,
                    isZeroOrder: true,
                },
            ],
            success: true,
            error: null
        });

        const mockGetOrdersStickers = jest.spyOn(service["wbOrderService"], "getOrdersStickers").mockResolvedValue({
            stickers: [],
            success: false,
            error: "Failed to fetch stickers"
        });

        await expect(service.getSupplyPositions("supply-123")).rejects.toThrow(new HttpException("Failed to fetch stickers", 400));
        expect(mockListOrders).toHaveBeenCalledWith("supply-123");
        expect(mockGetOrdersStickers).toHaveBeenCalledWith([123456789, 987654321]);
    });

    it("getSupplyPositions - no orders returned", async () => {
        const mockListOrders = jest.spyOn(service, "listOrders").mockResolvedValue({
            orders: [],
            success: true,
            error: null
        });

        const res = await service.getSupplyPositions("supply-123");

        expect(mockListOrders).toHaveBeenCalledWith("supply-123");
        expect(res).toEqual([]);


    });
});
