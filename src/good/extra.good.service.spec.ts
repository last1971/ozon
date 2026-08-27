import { Test, TestingModule } from "@nestjs/testing";
import { GOOD_SERVICE } from "../interfaces/IGood";
import { AVITO_GOOD_STORE } from "../interfaces/i.avito.good.store";
import { YandexOfferService } from "../yandex.offer/yandex.offer.service";
import { ExpressOfferService } from "../yandex.offer/express.offer.service";
import { ProductService } from "../product/product.service";
import { WbCardService } from "../wb.card/wb.card.service";
import { AvitoCardService } from "../avito.card/avito.card.service";
import { SyliusProductService } from "../sylius/sylius.product.service";
import { ExtraGoodService } from "./extra.good.service";
import { GoodServiceEnum } from "./good.service.enum";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { GoodsCountProcessor } from "../helpers/good/goods.count.processor";
import { LoadSnapshotCommand } from "../helpers/good/commands/load-snapshot.command";
import { MapSkusToGoodsCommand } from "../helpers/good/commands/map-skus-to-goods.command";
import { DistributePlainCountsCommand } from "../helpers/good/commands/distribute-plain-counts.command";
import { DistributeMarkedCountsCommand } from "../helpers/good/commands/distribute-marked-counts.command";
import { ApplyDisabledCommand } from "../helpers/good/commands/apply-disabled.command";
import { KeepChangedOnlyCommand } from "../helpers/good/commands/keep-changed-only.command";
import { PushCountsCommand } from "../helpers/good/commands/push-counts.command";
import { ResolveDisableTokensCommand } from "./commands/resolve-disable-tokens.command";
import { WriteDisabledFlagCommand } from "./commands/write-disabled-flag.command";
import { ClearDisabledFlagCommand } from "./commands/clear-disabled-flag.command";
import { PushZeroCountsCommand } from "./commands/push-zero-counts.command";
import { RestoreCountsCommand } from "./commands/restore-counts.command";
import Excel from 'exceljs';

describe('ExtraGoodService', () => {
    let service: ExtraGoodService;
    const updateCountForService = jest.fn();
    const loadSkuList = jest.fn();
    const updateGoodCounts = jest.fn();
    const mockIn = jest.fn();
    const setWbData = jest.fn().mockResolvedValue(undefined);
    const setAvitoData = jest.fn().mockResolvedValue(undefined);
    const setPercents = jest.fn().mockResolvedValue(undefined);
    const setGoodsDisabled = jest.fn().mockResolvedValue(undefined);
    const clearGoodsDisabled = jest.fn().mockResolvedValue(undefined);
    const getDisabledCodes = jest.fn().mockResolvedValue([]);
    const getGoodIds = jest.fn().mockResolvedValue(
        { goods: new Map<string, number>(), nextArgs: '' },
    );
    const emit = jest.fn();
    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExtraGoodService,
                GoodsCountProcessor,
                LoadSnapshotCommand,
                MapSkusToGoodsCommand,
                DistributePlainCountsCommand,
                DistributeMarkedCountsCommand,
                ApplyDisabledCommand,
                KeepChangedOnlyCommand,
                PushCountsCommand,
                { provide: GOOD_SERVICE, useValue: { updateCountForService, in: mockIn, setWbData, setPercents, setGoodsDisabled, clearGoodsDisabled, getDisabledCodes } },
                { provide: AVITO_GOOD_STORE, useValue: { setAvitoData, getAvitoData: jest.fn(), getAllAvitoGoods: jest.fn(), disableAvitoGoods: jest.fn() } },
                { provide: YandexOfferService, useValue: { test: "Yandex", skuList: [], getGoodIds } },
                { provide: ExpressOfferService, useValue: { skuList: [], getGoodIds } },
                { provide: ProductService, useValue: { skuList: ["222", "222-10"], updateGoodCounts, getGoodIds } },
                { provide: WbCardService, useValue: { loadSkuList, skuList: ["111"], updateGoodCounts, getGoodIds } },
                { provide: AvitoCardService, useValue: { skuList: [], updateGoodCounts, getGoodIds } },
                { provide: SyliusProductService, useValue: { skuList: [], updateGoodCounts, getGoodIds } },
                { provide: ConfigService, useValue: { get: () => Object.values(GoodServiceEnum) } },
                { provide: EventEmitter2, useValue: { emit } },
                ResolveDisableTokensCommand,
                WriteDisabledFlagCommand,
                ClearDisabledFlagCommand,
                PushZeroCountsCommand,
                RestoreCountsCommand,
            ],
        }).compile();

        updateCountForService.mockClear();
        updateGoodCounts.mockClear();
        service = module.get<ExtraGoodService>(ExtraGoodService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should return a valid service when the service is included and enabled in the configuration", () => {
        const result = service.getCountUpdateableService(GoodServiceEnum.WB);
        expect(result).toBeDefined();
        expect(result).toHaveProperty("skuList", ["111"]);
    });

    it("should return null when the service is not included in the configuration", () => {
        const result = service.getCountUpdateableService(null);
        expect(result).toBeNull();
    });

    it("updateService", async () => {
        await service.updateService(GoodServiceEnum.YANDEX);
        expect(getGoodIds.mock.calls[0]).toEqual([""]);
    });

    it("test checkGoodCount", async () => {
        await service.checkGoodCount();
        expect(getGoodIds.mock.calls).toHaveLength(6);
    });

    it("serviceIsSwitchedOn", async () => {
        updateGoodCounts.mockResolvedValueOnce(1);
        const res = await service.serviceIsSwitchedOn({ service: GoodServiceEnum.WB, isSwitchedOn: false });
        expect(res).toEqual({ isSuccess: true, message: "Service wb is switched off and reset 1 skus" });
        expect(updateGoodCounts.mock.calls[0]).toEqual([new Map<string, number>([["111", 0]])]);
    });

    it("loadSkuList", async () => {
        await service.loadSkuList(GoodServiceEnum.WB);
        await service.serviceIsSwitchedOn({ service: GoodServiceEnum.YANDEX, isSwitchedOn: false });
        await service.loadSkuList(GoodServiceEnum.YANDEX);
        expect(loadSkuList.mock.calls).toHaveLength(1);
    });

    it("loadSkuList отключает сервис и шлёт письмо при падении", async () => {
        const err: any = new Error("boom");
        err.response = { data: { message: "Некорректный формат входных параметров" } };
        loadSkuList.mockRejectedValueOnce(err);

        const res = await service.loadSkuList(GoodServiceEnum.WB);

        expect(res.isSuccess).toBe(false);
        expect(emit).toHaveBeenCalledWith(
            'error.message',
            expect.stringContaining('wb'),
            expect.stringContaining('Некорректный формат входных параметров'),
        );

        // сервис отключён → повторный вызов не дёргает loadSkuList и возвращает "is switched off"
        loadSkuList.mockClear();
        const res2 = await service.loadSkuList(GoodServiceEnum.WB);
        expect(loadSkuList).not.toHaveBeenCalled();
        expect(res2.message).toContain('is switched off');
    });

    it("countsChanged", async () => {
        const mockProcessGoodsCountChanges = jest.spyOn(GoodsCountProcessor.prototype, "processGoodsCountChanges").mockResolvedValue();

        await service.countsChanged([
            { code: '111', quantity: 10, reserve: 1, name: '111' },
            { code: '222', quantity: 2, reserve: null, name: '222' },
        ]);

        // Проверяем вызов processGoodsCountChanges: карта сервисов теперь приходит параметром
        expect(mockProcessGoodsCountChanges).toHaveBeenCalledWith(expect.any(Map), [
            { code: '111', quantity: 10, reserve: 1, name: '111' },
            { code: '222', quantity: 2, reserve: null, name: '222' },
        ]);

        // Восстанавливаем оригинальное поведение
        mockProcessGoodsCountChanges.mockRestore();
    });

    it("should return matching SKUs for the given service if SKUs exist", () => {
        const tradeSkus = ["111", "222"];
        const serviceEnum = GoodServiceEnum.OZON;
        const matchingSkus = service.tradeSkusToServiceSkus(tradeSkus, serviceEnum);
        expect(matchingSkus).toEqual(["222", "222-10"]);
    });

    it("should return an empty array if the service does not have any matching SKUs", () => {
        const tradeSkus = ["nonexistent"];
        const serviceEnum = GoodServiceEnum.YANDEX;
        const result = service.tradeSkusToServiceSkus(tradeSkus, serviceEnum);
        expect(result).toEqual([]);
    });

    it("should return an empty array if the service is not enabled or found", () => {
        const tradeSkus = ["trade1"];
        const serviceEnum = null;
        const result = service.tradeSkusToServiceSkus(tradeSkus, serviceEnum);
        expect(result).toEqual([]);
    });

    it("should return an empty array if no SKUs are provided", () => {
        const tradeSkus: string[] = [];
        const serviceEnum = GoodServiceEnum.WB;
        const result = service.tradeSkusToServiceSkus(tradeSkus, serviceEnum);
        expect(result).toEqual([]);
    });

    describe('getSkuList', () => {
        it('should return SKU list for OZON service', () => {
            const result = service.getSkuList(GoodServiceEnum.OZON);
            expect(result).toEqual(["222", "222-10"]);
        });

        it('should return SKU list for WB service', () => {
            const result = service.getSkuList(GoodServiceEnum.WB);
            expect(result).toEqual(["111"]);
        });

        it('should return empty array for YANDEX service with no SKUs', () => {
            const result = service.getSkuList(GoodServiceEnum.YANDEX);
            expect(result).toEqual([]);
        });

        it('should return empty array for non-existent service', () => {
            const result = service.getSkuList(null);
            expect(result).toEqual([]);
        });

        it('should return empty array for EXPRESS service', () => {
            const result = service.getSkuList(GoodServiceEnum.EXPRESS);
            expect(result).toEqual([]);
        });
    });

    describe('disable (цепочка resolve→write→pushZero)', () => {
        it('level=sku — пишет sku-блок и пушит 0 только по нему', async () => {
            updateGoodCounts.mockResolvedValueOnce(1);
            const res = await service.disable(GoodServiceEnum.WB, ['111'], 'sku');
            expect(setGoodsDisabled).toHaveBeenCalledWith(['111'], GoodServiceEnum.WB);
            expect(updateGoodCounts.mock.calls[0][0]).toEqual(new Map<string, number>([['111', 0]]));
            expect(res).toEqual({ isSuccess: true, message: 'Service wb disabled 1 skus' });
        });

        it('level=good — пишет good-блок (good:222) и обнуляет все фасовки', async () => {
            updateGoodCounts.mockResolvedValueOnce(2);
            const res = await service.disable(GoodServiceEnum.OZON, ['222'], 'good');
            expect(setGoodsDisabled).toHaveBeenCalledWith(['good:222'], GoodServiceEnum.OZON);
            expect(updateGoodCounts.mock.calls[0][0]).toEqual(new Map<string, number>([['222', 0], ['222-10', 0]]));
            expect(res.message).toBe('Service ozon disabled 2 skus');
        });

        it('КЛЮЧЕВОЕ: level=sku на 222 не трогает фасовку 222-10', async () => {
            updateGoodCounts.mockResolvedValueOnce(1);
            await service.disable(GoodServiceEnum.OZON, ['222'], 'sku');
            expect(setGoodsDisabled).toHaveBeenCalledWith(['222'], GoodServiceEnum.OZON);
            expect(updateGoodCounts.mock.calls[0][0]).toEqual(new Map<string, number>([['222', 0]]));
        });

        it('пустой ввод → stopChain, флаг не пишется и 0 не пушится', async () => {
            const res = await service.disable(GoodServiceEnum.WB, ['', '  '], 'sku');
            expect(res.isSuccess).toBe(false);
            expect(res.message).toContain('Не передано ни одного SKU');
            expect(setGoodsDisabled).not.toHaveBeenCalled();
            expect(updateGoodCounts).not.toHaveBeenCalled();
        });

        it('несконфигурированный сервис — not configured', async () => {
            const res = await service.disable(null, ['111'], 'sku');
            expect(res).toEqual({ isSuccess: false, message: 'Service null not configured' });
            expect(setGoodsDisabled).not.toHaveBeenCalled();
        });
    });

    describe('enable (цепочка resolve→clear→restore)', () => {
        it('level=sku — снимает sku-блок и пересчитывает товар', async () => {
            const goods = [{ code: '222', quantity: 10, reserve: 0, name: 'x' }];
            mockIn.mockResolvedValueOnce(goods);
            const spy = jest.spyOn(service, 'countsChanged').mockResolvedValue();

            const res = await service.enable(GoodServiceEnum.OZON, ['222-10'], 'sku');

            expect(clearGoodsDisabled).toHaveBeenCalledWith(['222-10'], GoodServiceEnum.OZON);
            expect(mockIn).toHaveBeenCalledWith(['222'], null); // goodCode('222-10')
            expect(spy).toHaveBeenCalledWith(goods);
            expect(res.message).toBe('Service ozon enabled 1 skus');
            spy.mockRestore();
        });

        it('level=good — снимает good-блок (good:222)', async () => {
            mockIn.mockResolvedValueOnce([]);
            const spy = jest.spyOn(service, 'countsChanged').mockResolvedValue();

            await service.enable(GoodServiceEnum.OZON, ['222'], 'good');

            expect(clearGoodsDisabled).toHaveBeenCalledWith(['good:222'], GoodServiceEnum.OZON);
            expect(mockIn).toHaveBeenCalledWith(['222'], null);
            spy.mockRestore();
        });

        it('пустой ввод → stopChain, флаг не снимается', async () => {
            const res = await service.enable(GoodServiceEnum.WB, [], 'sku');
            expect(res.isSuccess).toBe(false);
            expect(clearGoodsDisabled).not.toHaveBeenCalled();
        });
    });

    describe('enableAll (разморозить всё: clear→restore по хранимым кодам)', () => {
        it('снимает ВСЕ блокировки сервиса и пересчитывает товары', async () => {
            getDisabledCodes.mockResolvedValueOnce(['222-10', 'good:333']);
            const goods = [
                { code: '222', quantity: 10, reserve: 0, name: 'x' },
                { code: '333', quantity: 5, reserve: 0, name: 'y' },
            ];
            mockIn.mockResolvedValueOnce(goods);
            const spy = jest.spyOn(service, 'countsChanged').mockResolvedValue();

            const res = await service.enableAll(GoodServiceEnum.OZON);

            expect(clearGoodsDisabled).toHaveBeenCalledWith(['222-10', 'good:333'], GoodServiceEnum.OZON);
            expect(mockIn).toHaveBeenCalledWith(['222', '333'], null); // goodCode из хранимых токенов
            expect(spy).toHaveBeenCalledWith(goods);
            expect(res).toEqual({ isSuccess: true, message: 'Service ozon enabled 2 skus' });
            spy.mockRestore();
        });

        it('нечего размораживать → 0 skus, clear не вызывается', async () => {
            getDisabledCodes.mockResolvedValueOnce([]);
            const res = await service.enableAll(GoodServiceEnum.WB);
            expect(res).toEqual({ isSuccess: true, message: 'Service wb enabled 0 skus' });
            expect(clearGoodsDisabled).not.toHaveBeenCalled();
        });

        it('несконфигурированный сервис → ошибка', async () => {
            const res = await service.enableAll(null);
            expect(res.isSuccess).toBe(false);
            expect(getDisabledCodes).not.toHaveBeenCalled();
        });
    });

    describe('read-геттеры статуса', () => {
        it('listServices — все сервисы с isSwitchedOn', () => {
            const list = service.listServices();
            expect(list).toEqual(expect.arrayContaining([
                { service: GoodServiceEnum.WB, isSwitchedOn: true },
                { service: GoodServiceEnum.OZON, isSwitchedOn: true },
            ]));
        });

        it('getDisabled — раскодирует уровень из хранимого кода', async () => {
            getDisabledCodes.mockResolvedValueOnce(['222', 'good:333']);
            const res = await service.getDisabled(GoodServiceEnum.OZON);
            expect(res).toEqual([
                { code: '222', level: 'sku' },
                { code: '333', level: 'good' },
            ]);
        });

        it('getStatus — good-блок 222 гасит весь товар (active 0)', async () => {
            // OZON skuList = ["222","222-10"]; good:222 → обе фасовки off
            getDisabledCodes.mockResolvedValueOnce(['good:222']);
            const res = await service.getStatus(GoodServiceEnum.OZON);
            expect(res).toEqual({ isSwitchedOn: true, total: 2, active: 0, disabled: [{ code: '222', level: 'good' }] });
        });

        it('getStatus — sku-блок 222 гасит только штучную, 222-10 активна (active 1)', async () => {
            getDisabledCodes.mockResolvedValueOnce(['222']);
            const res = await service.getStatus(GoodServiceEnum.OZON);
            expect(res).toEqual({ isSwitchedOn: true, total: 2, active: 1, disabled: [{ code: '222', level: 'sku' }] });
        });

        it('getStatus — несконфигурированный сервис', async () => {
            const res = await service.getStatus(null);
            expect(res).toEqual({ isSwitchedOn: false, total: 0, active: 0, disabled: [] });
        });
    });

    describe('resetBalances (после рефактора на zeroBalances)', () => {
        it('включённый сервис не обнуляет остатки', async () => {
            const count = await service.resetBalances(GoodServiceEnum.WB);
            expect(count).toBe(0);
            expect(updateGoodCounts).not.toHaveBeenCalled();
        });

        it('выключенный сервис обнуляет весь skuList', async () => {
            updateGoodCounts.mockResolvedValueOnce(1);
            await service.serviceIsSwitchedOn({ service: GoodServiceEnum.WB, isSwitchedOn: false });
            expect(updateGoodCounts.mock.calls[0]).toEqual([new Map<string, number>([['111', 0]])]);
        });
    });

    describe('xlsx imports', () => {
        function createXlsxBuffer(rows: any[][]): Promise<Excel.Buffer> {
            const wb = new Excel.Workbook();
            const ws = wb.addWorksheet('Sheet1');
            rows.forEach(r => ws.addRow(r));
            return wb.xlsx.writeBuffer();
        }

        it('skusFromFile читает столбец «SKU» из xlsx', async () => {
            const buffer = await createXlsxBuffer([
                ['SKU', 'name'],
                ['A1', 'foo'],
                ['A2', 'bar'],
            ]);
            const skus = await service.skusFromFile(buffer as unknown as Buffer);
            expect(skus).toEqual(['A1', 'A2']);
        });

        it('importWbFromXlsx should parse rows and call setWbData', async () => {
            const buffer = await createXlsxBuffer([
                ['WB001', 15, 50, 1200, 8001],
                ['WB002', 12, 45],
            ]);
            const result = await service.importWbFromXlsx(buffer as unknown as Buffer);
            expect(result).toEqual({ updated: 2, errors: 0 });
            expect(setWbData).toHaveBeenCalledTimes(2);
            expect(setWbData.mock.calls[0][0]).toMatchObject({ id: 'WB001', commission: 15, tariff: 50 });
            expect(setWbData.mock.calls[1][0]).toMatchObject({ id: 'WB002', commission: 12, tariff: 45 });
        });

        it('importAvitoFromXlsx should parse rows and call setAvitoData', async () => {
            const buffer = await createXlsxBuffer([
                ['avito123', '12345', 2, 15.5],
                ['avito456', '67890', 1, 10],
            ]);
            const result = await service.importAvitoFromXlsx(buffer as unknown as Buffer);
            expect(result).toEqual({ updated: 2, errors: 0 });
            expect(setAvitoData).toHaveBeenCalledTimes(2);
            expect(setAvitoData.mock.calls[0][0]).toMatchObject({ id: 'avito123', goodsCode: '12345', coeff: 2, commission: 15.5 });
        });

        it('importPercentFromXlsx should parse rows and call setPercents', async () => {
            const buffer = await createXlsxBuffer([
                ['SKU001', 10, 25, 40, 5, 30, 5000],
                ['SKU002', 15, 30],
            ]);
            const result = await service.importPercentFromXlsx(buffer as unknown as Buffer);
            expect(result).toEqual({ updated: 2, errors: 0 });
            expect(setPercents).toHaveBeenCalledTimes(2);
            expect(setPercents.mock.calls[0][0]).toMatchObject({ offer_id: 'SKU001', min_perc: 10, perc: 25, old_perc: 40 });
            expect(setPercents.mock.calls[1][0]).toMatchObject({ offer_id: 'SKU002', min_perc: 15, perc: 30 });
        });

        it('importWbFromXlsx should skip empty rows', async () => {
            const buffer = await createXlsxBuffer([
                ['WB001', 15, 50],
                [null],
                ['WB002', 12, 45],
            ]);
            const result = await service.importWbFromXlsx(buffer as unknown as Buffer);
            expect(result).toEqual({ updated: 2, errors: 0 });
            expect(setWbData).toHaveBeenCalledTimes(2);
        });
    });

});
