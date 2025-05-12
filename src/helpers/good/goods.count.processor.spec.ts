import { GoodsCountProcessor } from "./goods.count.processor";
import { Logger } from "@nestjs/common";
import { GoodServiceEnum } from "../../good/good.service.enum";
import { ICountUpdateable } from "src/interfaces/ICountUpdatebale";
import { GoodDto } from "../../good/dto/good.dto";
import { IGood } from "../../interfaces/IGood";

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
            { code: "hz", quantity: 30, reserve: 5 },
        ] as GoodDto[];

        // SKU, предварительно отфильтрованные для товаров
        const filteredSkuMap = new Map<string, string[]>([
            ["sku", ["sku-1", "sku-2"]],
            ["hz", ["hz-2", "hz-3"]],
        ]);

        const spyDistributeGoodQuantities = jest.spyOn(
            GoodsCountProcessor.prototype as any,
            "distributeGoodQuantities"
        );

        const processGoods = (GoodsCountProcessor.prototype as any).processGoods;

        // Вызываем метод processGoods без явного передачи кеша
        const skusToUpdate = processGoods.call(goodsCountProcessor, goods, filteredSkuMap);

        // Ожидание: метод distributeGoodQuantities был вызван
        expect(spyDistributeGoodQuantities).toHaveBeenCalled();

        // Ожидание: обновляются следующие SKU
        expect(Array.from(skusToUpdate.entries())).toEqual([
            ["sku-1", 14], // Ожидание: раньше данное значение было в кэше
            ["sku-2", 13], // Ожидание: раньше данное значение было в кэше
            ["hz-2", expect.any(Number)], // Ожидание: новый результат распределения
            ["hz-3", expect.any(Number)], // Ожидание: новый результат распределения
        ]);

        // Делаем дополнительное ожидание, проверяя кэш (через товары):
        expect(Array.from(goodsCountProcessor['quantityCache'].entries())).toEqual([
            ["sku-1", 14], // Проверка, что значение не изменилось
            ["sku-2", 13], // Проверка, что значение не изменилось
            ["hz-2", expect.any(Number)], // Проверка, что для новых SKU всё распределилось
            ["hz-3", expect.any(Number)], // Проверка, что для новых SKU всё распределилось
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

    it("should process goods recursively when nextArgs is present", async () => {
        // Отключение глобальной очистки специально для этого теста
        // afterEach(() => jest.clearAllMocks()); // Локально восстанавливаем вызовы

        // Подготавливаем моки на getGoodIds (возвращаются две страницы)
        (mockServiceOne.getGoodIds as jest.Mock)
            .mockResolvedValueOnce({
                goods: new Map([["aaa", 10], ["bbb", 20]]),
                nextArgs: { page: 2 },
            })
            .mockResolvedValueOnce({
                goods: new Map([["ccc", 5]]),
                nextArgs: null,
            });

        // Подготавливаем мок для goodService, чтобы возвращать данные о товарах
        const goodServiceMock = {
            in: jest.fn().mockResolvedValueOnce([
                { code: "aaa", quantity: 15, reserve: 0 },
                { code: "bbb", quantity: 15, reserve: 0 },
            ])
                .mockResolvedValueOnce([
                    { code: "ccc", quantity: 5, reserve: 0 }, // Второй вызов
                ])
                .mockResolvedValue([]), // Последующие вызовы возвращают пустой результат
        } as unknown as IGood;


        // Выполнение метода
        const result = await goodsCountProcessor.processGoodsCountForService(
            GoodServiceEnum.OZON,
            goodServiceMock,
            {}
        );

        // Ожидания
        expect(result).toBe(3); // 2 обновления из первой страницы, 1 из второй
        expect(mockServiceOne.getGoodIds).toHaveBeenCalledTimes(2); // Вызваны обе страницы
        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledTimes(2); // Обновление для двух батчей
    });

    it("should correctly update goods quantities for given items and service", async () => {
        // Моки данных для getGoodIds (возвращаются текущие остатки)
        (mockServiceOne.getGoodIds as jest.Mock).mockResolvedValueOnce({
            goods: new Map([
                ["sku-1", 10], // Начальный остаток: 10
                ["sku-2", 5],  // Начальный остаток: 5
                ["sku-3", 0],  // Начальный остаток: 0
                ["hz", 0],     // Начальный остаток: 0
            ]),
            nextArgs: null, // Нет дополнительных страниц
        });

        // Мок для goodService (emulation API call для `in`)
        const goodServiceMock = {
            in: jest.fn().mockResolvedValue([
                { code: "sku", quantity: 10, reserve: 0 },
                { code: "hz", quantity: 15, reserve: 0 },
            ]),
        } as unknown as IGood;

        // Выполнение метода
        const result = await goodsCountProcessor.processGoodsCountForService(
            GoodServiceEnum.OZON,
            goodServiceMock,
            {}
        );

        // Ожидания
        expect(result).toBe(3); // Обновиться должны 2 SKU

        // Проверить вызов updateGoodCounts
        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
            new Map([
                ["sku-1", 2],
                ["sku-2", 1],
                ["sku-3", 2],
            ])
        );

        // Проверить вызовы методов
        expect(mockServiceOne.getGoodIds).toHaveBeenCalledTimes(1);   // SKU загружены один раз
        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledTimes(1); // Произведено одно обновление
    });
});