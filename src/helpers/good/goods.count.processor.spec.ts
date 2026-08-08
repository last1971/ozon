import { CountUpdateableServices, GoodsCountProcessor } from "./goods.count.processor";
import { GoodServiceEnum } from "../../good/good.service.enum";
import { ICountUpdateable } from "src/interfaces/ICountUpdatebale";
import { GoodDto } from "../../good/dto/good.dto";
import { IGood } from "../../interfaces/IGood";
import { LoadSnapshotCommand } from "./commands/load-snapshot.command";
import { MapSkusToGoodsCommand } from "./commands/map-skus-to-goods.command";
import { DistributePlainCountsCommand } from "./commands/distribute-plain-counts.command";
import { DistributeMarkedCountsCommand } from "./commands/distribute-marked-counts.command";
import { ApplyDisabledCommand } from "./commands/apply-disabled.command";
import { KeepChangedOnlyCommand } from "./commands/keep-changed-only.command";
import { PushCountsCommand } from "./commands/push-counts.command";

describe("GoodsCountProcessor", () => {
    let goodsCountProcessor: GoodsCountProcessor;
    let services: CountUpdateableServices;
    let mockServiceOne: ICountUpdateable;
    let mockServiceTwo: ICountUpdateable;

    // Процессор собирает цепочку из команд; goodService подменяем на уровне LoadSnapshotCommand.
    const makeProcessor = (goodService?: Partial<IGood>): GoodsCountProcessor => {
        const good = {
            getTransaction: jest.fn().mockResolvedValue(null),
            in: jest.fn().mockResolvedValue([]),
            getDisabledCodes: jest.fn().mockResolvedValue([]),
            getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set()),
            getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set()),
            getFreeMarkCodesByNominal: jest.fn().mockResolvedValue(new Map()),
            ...goodService,
        } as unknown as IGood;

        const push = new PushCountsCommand();
        jest.spyOn(push["logger"], "log").mockImplementation(() => undefined);

        return new GoodsCountProcessor(
            new LoadSnapshotCommand(good),
            new MapSkusToGoodsCommand(),
            new DistributePlainCountsCommand(),
            new DistributeMarkedCountsCommand(),
            new ApplyDisabledCommand(),
            new KeepChangedOnlyCommand(),
            push,
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();

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

        services = new Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>([
            [GoodServiceEnum.OZON, { service: mockServiceOne, isSwitchedOn: true }],
            [GoodServiceEnum.WB, { service: mockServiceTwo, isSwitchedOn: false }]
        ]);

        goodsCountProcessor = makeProcessor();
    });

    it("считает только для включённых сервисов", async () => {
        const goods = [
            { code: "sku", quantity: 10, reserve: 2, name: "Good1" },
            { code: "hz", quantity: 5, reserve: 1, name: "Good3" }
        ] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(services, goods);

        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalled();
        expect(mockServiceTwo.updateGoodCounts).not.toHaveBeenCalled();
    });

    it("нет подходящих SKU — на маркет не ходим", async () => {
        mockServiceOne.skuList = [];
        const goods = [{ code: "mur", quantity: 10, reserve: 4, name: "Good7" }] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(services, goods);

        expect(mockServiceOne.updateGoodCounts).not.toHaveBeenCalled();
    });

    it("немаркируемый товар: остаток делится по фасовкам пропорционально", async () => {
        const goods = [{ code: "sku", quantity: 100, reserve: 0, name: "x" }] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(services, goods);

        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
            new Map([["sku-1", 17], ["sku-2", 16], ["sku-3", 17]]),
        );
    });

    it("нулевой остаток — нули по всем фасовкам", async () => {
        const goods = [{ code: "sku", quantity: 0, name: "Good1" }] as GoodDto[];

        await goodsCountProcessor.processGoodsCountChanges(services, goods);

        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
            new Map([["sku-1", 0], ["sku-2", 0], ["sku-3", 0]]),
        );
    });

    it("крон-путь: рекурсия по страницам маркета", async () => {
        (mockServiceOne.getGoodIds as jest.Mock)
            .mockResolvedValueOnce({ goods: new Map([["aaa", 10], ["bbb", 20]]), nextArgs: { page: 2 } })
            .mockResolvedValueOnce({ goods: new Map([["ccc", 5]]), nextArgs: null });

        const proc = makeProcessor({
            in: jest.fn()
                .mockResolvedValueOnce([
                    { code: "aaa", quantity: 15, reserve: 0 },
                    { code: "bbb", quantity: 15, reserve: 0 },
                ])
                .mockResolvedValueOnce([{ code: "ccc", quantity: 5, reserve: 0 }])
                .mockResolvedValue([]),
        });

        const result = await proc.processGoodsCountForService(services, GoodServiceEnum.OZON, {});

        expect(result).toBe(3); // 2 из первой страницы, 1 из второй
        expect(mockServiceOne.getGoodIds).toHaveBeenCalledTimes(2);
        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledTimes(2);
    });

    it("крон-путь: на маркет уходят только изменившиеся SKU", async () => {
        (mockServiceOne.getGoodIds as jest.Mock).mockResolvedValueOnce({
            goods: new Map([
                ["sku-1", 10], // станет 2
                ["sku-2", 5],  // станет 1
                ["sku-3", 0],  // станет 2
                ["hz", 0],     // нашего расчёта нет — остаётся 0, не шлём
            ]),
            nextArgs: null,
        });

        const proc = makeProcessor({
            in: jest.fn().mockResolvedValue([
                { code: "sku", quantity: 10, reserve: 0 },
                { code: "hz", quantity: 15, reserve: 0 },
            ]),
        });

        const result = await proc.processGoodsCountForService(services, GoodServiceEnum.OZON, {});

        expect(result).toBe(3);
        expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
            new Map([["sku-1", 2], ["sku-2", 1], ["sku-3", 2]]),
        );
    });

    it("выключенный сервис в крон-пути — ноль без запросов", async () => {
        const result = await goodsCountProcessor.processGoodsCountForService(services, GoodServiceEnum.WB, {});

        expect(result).toBe(0);
        expect(mockServiceTwo.getGoodIds).not.toHaveBeenCalled();
    });

    describe("отключённые товары (GOODS_DISABLED)", () => {
        const onlyOzon = () =>
            new Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>([
                [GoodServiceEnum.OZON, { service: mockServiceOne, isSwitchedOn: true }],
            ]);

        it("good-блок (good:sku) → все его SKU = 0, несмотря на склад", async () => {
            const getDisabledCodes = jest.fn().mockResolvedValue(["good:sku"]);
            const proc = makeProcessor({ getDisabledCodes });

            await proc.processGoodsCountChanges(onlyOzon(), [
                { code: "sku", quantity: 100, reserve: 0, name: "x" },
            ] as GoodDto[]);

            expect(getDisabledCodes).toHaveBeenCalledWith(GoodServiceEnum.OZON, null);
            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["sku-1", 0], ["sku-2", 0], ["sku-3", 0]]),
            );
        });

        it("sku-блок (sku-2) → 0 только у неё, соседи тянут склад", async () => {
            const proc = makeProcessor({ getDisabledCodes: jest.fn().mockResolvedValue(["sku-2"]) });

            await proc.processGoodsCountChanges(onlyOzon(), [
                { code: "sku", quantity: 100, reserve: 0, name: "x" },
            ] as GoodDto[]);

            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["sku-1", 17], ["sku-2", 0], ["sku-3", 17]]),
            );
        });

        it("крон-путь тоже уважает sku-блок", async () => {
            (mockServiceOne.getGoodIds as jest.Mock).mockResolvedValueOnce({
                goods: new Map([["sku-1", 5], ["sku-2", 5], ["sku-3", 5]]),
                nextArgs: null,
            });
            const proc = makeProcessor({
                in: jest.fn().mockResolvedValue([{ code: "sku", quantity: 100, reserve: 0 }]),
                getDisabledCodes: jest.fn().mockResolvedValue(["sku-1"]),
            });

            await proc.processGoodsCountForService(onlyOzon(), GoodServiceEnum.OZON, {});

            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["sku-1", 0], ["sku-2", 16], ["sku-3", 17]]),
            );
        });
    });

    describe("маркируемые товары считаются по свободным кодам", () => {
        const onlyOzon = () =>
            new Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>([
                [GoodServiceEnum.OZON, { service: mockServiceOne, isSwitchedOn: true }],
            ]);

        it("коды по номиналам вместо пропорции: 498824", async () => {
            mockServiceOne.skuList = ["498824", "498824-100", "498824-800"];
            const proc = makeProcessor({
                getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set(["498824"])),
                getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set(["498824"])),
                getFreeMarkCodesByNominal: jest.fn().mockResolvedValue(
                    new Map([["498824", new Map([[1, 16], [100, 12], [800, 9]])]]),
                ),
            });

            await proc.processGoodsCountChanges(onlyOzon(), [
                { code: "498824", quantity: 8416, reserve: 24, name: "x" },
            ] as GoodDto[]);

            // резерв 24 съедает код на 100 (единичных не хватает), остальное — по своим фасовкам
            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["498824", 16], ["498824-100", 11], ["498824-800", 9]]),
            );
        });

        it("маркируемый без единой строки в MARKCODES считается по-старому", async () => {
            mockServiceOne.skuList = ["548580", "548580-10"];
            const proc = makeProcessor({
                getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set(["548580"])),
                getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set()), // кодов не заводилось
            });

            await proc.processGoodsCountChanges(onlyOzon(), [
                { code: "548580", quantity: 100, reserve: 0, name: "x" },
            ] as GoodDto[]);

            // старая пропорция: 100 штук делятся по коэффициентам 1 и 10 (9 упаковок + 10 штучных)
            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["548580", 10], ["548580-10", 9]]),
            );
        });

        it("коды есть, но все разошлись по счетам — товар уходит в 0", async () => {
            mockServiceOne.skuList = ["569126", "569126-10"];
            const proc = makeProcessor({
                getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set(["569126"])),
                getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set(["569126"])),
                getFreeMarkCodesByNominal: jest.fn().mockResolvedValue(new Map()), // свободных нет
            });

            await proc.processGoodsCountChanges(onlyOzon(), [
                { code: "569126", quantity: 1066, reserve: 0, name: "x" },
            ] as GoodDto[]);

            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["569126", 0], ["569126-10", 0]]),
            );
        });

        it("отключение перебивает расчёт по кодам", async () => {
            mockServiceOne.skuList = ["498824", "498824-100"];
            const proc = makeProcessor({
                getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set(["498824"])),
                getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set(["498824"])),
                getFreeMarkCodesByNominal: jest.fn().mockResolvedValue(
                    new Map([["498824", new Map([[100, 12]])]]),
                ),
                getDisabledCodes: jest.fn().mockResolvedValue(["good:498824"]),
            });

            await proc.processGoodsCountChanges(onlyOzon(), [
                { code: "498824", quantity: 1200, reserve: 0, name: "x" },
            ] as GoodDto[]);

            expect(mockServiceOne.updateGoodCounts).toHaveBeenCalledWith(
                new Map([["498824", 0], ["498824-100", 0]]),
            );
        });
    });
});
