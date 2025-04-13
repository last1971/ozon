import { GoodsCountProcessor } from "./goods.count.processor";
import { Logger } from "@nestjs/common";
import { GoodServiceEnum } from "../good/good.service.enum";
import { ICountUpdateable } from "src/interfaces/ICountUpdatebale";
import { GoodDto } from "../good/dto/good.dto";

describe("GoodsCountProcessor", () => {
    let goodsCountProcessor: GoodsCountProcessor;
    let logger: Logger;
    let mockServiceOne: ICountUpdateable;
    let mockServiceTwo: ICountUpdateable;

    beforeEach(() => {
        jest.clearAllMocks(); // Сброс всех моков

        logger = { log: jest.fn() } as unknown as Logger;

        mockServiceOne = {
            updateGoodCounts: jest.fn(async (skusToUpdate) => skusToUpdate.size),
            getGoodIds: jest.fn(async () => ({ goods: new Map(), nextArgs: null })),
            infoList: jest.fn(async () => []),
            loadSkuList: jest.fn(async () => {}),
            skuList: ["sku-1", "sku-2", "sku-3"]
        };

        mockServiceTwo = {
            updateGoodCounts: jest.fn(async (skusToUpdate) => skusToUpdate.size),
            getGoodIds: jest.fn(async () => ({ goods: new Map(), nextArgs: null })),
            infoList: jest.fn(async () => []),
            loadSkuList: jest.fn(async () => {}),
            skuList: ["hz-1", "hz-2", "hz-3"]
        };

        const services = new Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>([
            [GoodServiceEnum.OZON, { service: mockServiceOne, isSwitchedOn: true }],
            [GoodServiceEnum.WB, { service: mockServiceTwo, isSwitchedOn: false }]
        ]);

        goodsCountProcessor = new GoodsCountProcessor(services, logger);
    });

    afterEach(() => {
        jest.restoreAllMocks(); // Восстановить все спаи
    });

    it("should process goods count changes for active services", async () => {
        const goods = [
            { code: "sku", quantity: 10, reserve: 2, name: "Good1" },
            { code: "hz", quantity: 5, reserve: 1, name: "Good3" }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalled();
        expect(mockServiceTwo.updateGoodCounts).not.toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith("Updated 3 SKUs in ozon");
    });

    it("should skip inactive services", async () => {
        const goods = [
            { code: "hz", quantity: 15, reserve: 5, name: "Good4" }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        expect(mockServiceOne.updateGoodCounts).not.toHaveBeenCalledWith(goods);
        expect(mockServiceTwo.updateGoodCounts).not.toHaveBeenCalled();
    });

    it("should not update services if no skus to update", async () => {
        mockServiceOne.skuList = [];
        const goods = [
            { code: "mur", quantity: 10, reserve: 4, name: "Good7" }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        expect(mockServiceOne.updateGoodCounts).not.toHaveBeenCalled();
        expect(logger.log).not.toHaveBeenCalled();
    });

    it("should handle goods with no quantities or reserves gracefully", async () => {
        const goods = [
            { code: "sku", quantity: 0, name: "Good1" },
            { code: "hz", quantity: 0, name: "Good2" }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(new Map([['sku-1', 0], ['sku-2', 0], ['sku-3', 0]]));
        expect(mockServiceTwo.updateGoodCounts).not.toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith('Updated 3 SKUs in ozon');
    });

    // Тесты precomputeFilteredSkus
    it("should call precomputeFilteredSkus with correct goods and skuList", async () => {
        const goods = [
            { code: "sku", quantity: 20 },
            { code: "hz", quantity: 5 },
            { code: "mur", quantity: 2 }
        ] as GoodDto[];

        const spyPrecomputeFilteredSkus = jest.spyOn(
            GoodsCountProcessor.prototype as any,
            "precomputeFilteredSkus"
        );

        await goodsCountProcessor.processGoodsCountChanges(goods);

        expect(spyPrecomputeFilteredSkus).toHaveBeenCalledWith(goods, mockServiceOne.skuList);
    });

    // Тесты distributeGoods
    it("should correctly distribute goods proportionally to coefficients", async () => {
        const totalQuantity = 100;
        const skus = [
            { sku: "sku-3", coefficient: 3 },
            { sku: "sku-2", coefficient: 2 },
            { sku: "sku-1", coefficient: 1 },
        ];

        const spyDistributeGoods = jest.spyOn(
            GoodsCountProcessor.prototype as any,
            "distributeGoods"
        );

        const goods = [
            { code: "sku", quantity: totalQuantity, reserve: 0 }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        const distributionResult = spyDistributeGoods.mock.results[0].value;

        expect(spyDistributeGoods).toHaveBeenCalledWith(totalQuantity, skus);
        expect(distributionResult).toEqual({
            'sku-1': 17,
            'sku-2': 16,
            'sku-3': 17,
        });
    });

    it("should handle cases where totalQuantity is zero", async () => {
        const totalQuantity = 0;
        const skus = [
            { sku: "sku-1", coefficient: 1 },
            { sku: "sku-2", coefficient: 2 }
        ];

        const spyDistributeGoods = jest.spyOn(
            GoodsCountProcessor.prototype as any,
            "distributeGoods"
        );

        const goods = [
            { code: "sku", quantity: totalQuantity }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        const distributionResult = spyDistributeGoods.mock.results[0].value;

        expect(distributionResult).toEqual({
            'sku-1': 0,
            'sku-2': 0,
            'sku-3': 0,
        });
    });

    it("should allocate remaining quantities correctly", async () => {
        const totalQuantity = 101;
        const skus = [
            { sku: "sku-1", coefficient: 1 },
            { sku: "sku-2", coefficient: 2 },
            { sku: "sku-3", coefficient: 3 }
        ];

        const spyDistributeGoods = jest.spyOn(
            GoodsCountProcessor.prototype as any,
            "distributeGoods"
        );

        const goods = [
            { code: "sku", quantity: totalQuantity, reserve: 0 }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(goods);

        const distributionResult = spyDistributeGoods.mock.results[0].value;

        expect(distributionResult).toEqual({
            'sku-1': 16,
            'sku-2': 17,
            'sku-3': 17,
        });
    });

    it("should correctly process goods and update caches", () => {
        const goods = [
            { code: "sku", quantity: 50, reserve: 10 },
            { code: "hz", quantity: 30, reserve: 5 }
        ] as GoodDto[];

        const filteredSkuMap = new Map<string, string[]>([
            ["sku", ["sku-1", "sku-2"]],
            ["hz", ["hz-2", "hz-3"]]
        ]);

        const quantityCache = new Map<string, number>([
            ["sku-1", 10],
            ["sku-2", 15]
        ]);

        const spyDistributeGoodQuantities = jest.spyOn(
            GoodsCountProcessor.prototype as any,
            "distributeGoodQuantities"
        );

        const processGoods = (GoodsCountProcessor.prototype as any).processGoods;

        const { skusToUpdate, updatedCache } = processGoods.call(
            goodsCountProcessor,
            goods,
            filteredSkuMap,
            quantityCache
        );

        expect(spyDistributeGoodQuantities).toHaveBeenCalled();
        expect(Array.from(skusToUpdate.entries())).toEqual([
            ["sku-1", 10], // Изменённое значение
            ["sku-2", 15], // Изменённое значение
            ["hz-2", expect.any(Number)], // Новое значение после распределения
            ["hz-3", expect.any(Number)]  // Новое значение после распределения
        ]);

        expect(Array.from(updatedCache.entries())).toEqual([
            ["sku-1", 10],
            ["sku-2", 15],
            ["hz-2", expect.any(Number)],
            ["hz-3", expect.any(Number)]
        ]);
    });

    it("should update service with skus if there are skus to update", async () => {
        const skusToUpdate = new Map<string, number>([
            ["sku-1", 10],
            ["sku-2", 20]
        ]);

        const spyUpdateGoodCounts = jest.spyOn(mockServiceOne, "updateGoodCounts");

        const updateServiceWithSkus = (GoodsCountProcessor.prototype as any).updateServiceWithSkus;

        await updateServiceWithSkus.call(goodsCountProcessor, mockServiceOne, skusToUpdate, "ozon");

        expect(spyUpdateGoodCounts).toHaveBeenCalledWith(skusToUpdate);
        expect(logger.log).toHaveBeenCalledWith("Updated 2 SKUs in ozon");
    });

    it("should not update service if there are no skus to update", async () => {
        const skusToUpdate = new Map<string, number>(); // Пустой список SKU

        const spyUpdateGoodCounts = jest.spyOn(mockServiceOne, "updateGoodCounts");

        const updateServiceWithSkus = (GoodsCountProcessor.prototype as any).updateServiceWithSkus;

        await updateServiceWithSkus.call(goodsCountProcessor, mockServiceOne, skusToUpdate, "ozon");

        expect(spyUpdateGoodCounts).not.toHaveBeenCalled();
        expect(logger.log).not.toHaveBeenCalledWith();
    });

});