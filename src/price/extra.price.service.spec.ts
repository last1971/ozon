import { Test, TestingModule } from "@nestjs/testing";
import { ExtraPriceService } from "./extra.price.service";
import { ConfigService } from "@nestjs/config";
import { PriceService } from "./price.service";
import { YandexPriceService } from "../yandex.price/yandex.price.service";
import { WbPriceService } from "../wb.price/wb.price.service";
import { GOOD_SERVICE, IGood } from "../interfaces/IGood";
import { GoodServiceEnum } from "../good/good.service.enum";
import { UpdatePriceDto } from "./dto/update.price.dto";
import { WbCommissionDto } from "../wb.card/dto/wb.commission.dto";
import { ExtraGoodService } from "../good/extra.good.service";

jest.mock("../yandex.price/yandex.price.service");
jest.mock("../wb.price/wb.price.service");
jest.mock("./price.service");
jest.mock("../good/extra.good.service");

describe("ExtraPriceService", () => {
    let extraPriceService: ExtraPriceService;

    // Корректный мок для ConfigService
    const mockConfigService = {
        get: jest.fn((key, defaultValue) => defaultValue),
        internalConfig: {},
        getOrThrow: jest.fn(),
        // Добавляем все методы из ConfigService, которые могут использоваться
        onModuleInit: jest.fn(),
        isNotInProcessRef: jest.fn(),
        processRef: jest.fn(),
        createProxy: jest.fn(),
        validate: jest.fn()
    };

    // Моки для сервисов, используем настоящие классы
    const mockPriceService = new PriceService(null, null, null, null) as jest.Mocked<PriceService>;
    mockPriceService.getObtainCoeffs = jest.fn();
    mockPriceService.getProductsWithCoeffs = jest.fn();
    mockPriceService.updatePrices = jest.fn();
    mockPriceService.updateAllPrices = jest.fn();
    mockPriceService.createAction = jest.fn();

    const mockYandexPriceService = new YandexPriceService(null, null, null, null, null) as jest.Mocked<YandexPriceService>;
    mockYandexPriceService.getObtainCoeffs = jest.fn();
    mockYandexPriceService.getProductsWithCoeffs = jest.fn();
    mockYandexPriceService.updatePrices = jest.fn();
    mockYandexPriceService.updateAllPrices = jest.fn();
    mockYandexPriceService.createAction = jest.fn();

    const mockWbPriceService = new WbPriceService(null, null, null, null) as jest.Mocked<WbPriceService>;
    mockWbPriceService.getObtainCoeffs = jest.fn();
    mockWbPriceService.getProductsWithCoeffs = jest.fn();
    mockWbPriceService.updatePrices = jest.fn();
    mockWbPriceService.updateAllPrices = jest.fn();
    mockWbPriceService.createAction = jest.fn();

    const mockExtraGoodService: jest.Mocked<ExtraGoodService> = {
        tradeSkusToServiceSkus: jest.fn(),
        // Добавьте моки для других методов ExtraGoodService, если они вызываются
        // в коде ExtraPriceService, который вы тестируете
    } as any;

    // Полный мок для IGood
    const mockGoodService = {
        in: jest.fn(),
        prices: jest.fn(),
        setPercents: jest.fn(),
        getPerc: jest.fn(),
        setWbData: jest.fn(),
        getWbData: jest.fn(),
        getQuantities: jest.fn(),
        updateCountForService: jest.fn(),
        updateCountForSkus: jest.fn(),
        updatePriceForService: jest.fn(),
        updateWbCategory: jest.fn(),
        getWbCategoryByName: jest.fn(),
        resetAvailablePrice: jest.fn()
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExtraPriceService,
                { provide: ConfigService, useValue: mockConfigService },
                { provide: PriceService, useValue: mockPriceService },
                { provide: YandexPriceService, useValue: mockYandexPriceService },
                { provide: WbPriceService, useValue: mockWbPriceService },
                { provide: GOOD_SERVICE, useValue: mockGoodService },
                { provide: ExtraGoodService, useValue: mockExtraGoodService },
            ]
        }).compile();

        extraPriceService = module.get<ExtraPriceService>(ExtraPriceService);
    });

    describe("getService", () => {
        it("should return the correct service based on the service type", () => {
            // Перезаписываем мок для конкретного теста
            mockConfigService.get.mockImplementation((key, defaultValue) => {
                if (key === 'SERVICES') return [GoodServiceEnum.OZON, GoodServiceEnum.YANDEX];
                return defaultValue;
            });

            // Создаем мок для ExtraGoodService (предполагаем, что это пустой объект или мок с нужными методами)
            const mockExtraGoodService = {} as any; // Замените 'any' на правильный тип, если известен

            // Пересоздаем сервис с новыми моками
            extraPriceService = new ExtraPriceService(
                mockPriceService as unknown as PriceService,
                mockYandexPriceService as unknown as YandexPriceService,
                mockWbPriceService as unknown as WbPriceService,
                mockGoodService as unknown as IGood,
                mockConfigService as unknown as ConfigService,
                mockExtraGoodService // Добавляем шестой аргумент
            );

            const service = extraPriceService.getService(GoodServiceEnum.OZON);
            expect(service).toBe(mockPriceService);

        });

        it("should return null if the service type is not found", () => {
            mockConfigService.get.mockReturnValue([]);

            // Сбрасываем карту сервисов
            extraPriceService["services"] = new Map();

            const service = extraPriceService.getService(GoodServiceEnum.EXPRESS);
            expect(service).toBeNull();
        });
    });

    describe("getServices", () => {
        it("should return all registered services", () => {
            mockConfigService.get.mockReturnValue([GoodServiceEnum.OZON, GoodServiceEnum.YANDEX, GoodServiceEnum.WB]);

            // Устанавливаем сервисы напрямую
            extraPriceService["services"] = new Map();
            extraPriceService["services"].set(GoodServiceEnum.OZON, mockPriceService);
            extraPriceService["services"].set(GoodServiceEnum.YANDEX, mockYandexPriceService);
            extraPriceService["services"].set(GoodServiceEnum.WB, mockWbPriceService);

            const services = extraPriceService.getServices();
            expect(services).toEqual([mockPriceService, mockYandexPriceService, mockWbPriceService]);
        });
    });

    describe("updatePriceForServices", () => {
        it("should call updatePriceForService for each service with the correct arguments", async () => {
            // Устанавливаем сервисы напрямую
            extraPriceService["services"] = new Map();
            extraPriceService["services"].set(GoodServiceEnum.OZON, mockPriceService);
            extraPriceService["services"].set(GoodServiceEnum.WB, mockWbPriceService);

            const skus = ["sku1", "sku2"];
            const pricesMap = new Map<string, UpdatePriceDto>();

            pricesMap.set("sku1", {
                min_price: "100",
                old_price: "150",
                price: "120",
                offer_id: "sku1",
                currency_code: "RUB"
            });

            pricesMap.set("sku2", {
                min_price: "200",
                old_price: "250",
                price: "220",
                offer_id: "sku2",
                currency_code: "RUB"
            });

            mockGoodService.updatePriceForService.mockResolvedValue({});

            await extraPriceService.updatePriceForServices(skus, pricesMap);

            expect(mockGoodService.updatePriceForService).toHaveBeenCalledWith(mockPriceService, skus, pricesMap);
            expect(mockGoodService.updatePriceForService).toHaveBeenCalledWith(mockWbPriceService, skus, pricesMap);
        });
    });

    describe("updatePriceForGoodSkus", () => {
        it("should call tradeSkusToServiceSkus for each serviceEnum", async () => {
            // Mock the services map
            extraPriceService["services"] = new Map();
            extraPriceService["services"].set(GoodServiceEnum.YANDEX, mockYandexPriceService);
            extraPriceService["services"].set(GoodServiceEnum.WB, mockWbPriceService);

            const skus = ["sku1", "sku2"];
            mockExtraGoodService.tradeSkusToServiceSkus.mockReturnValueOnce(["serviceSku1"]).mockReturnValueOnce(["serviceSku2"]);
            mockGoodService.updatePriceForService.mockResolvedValue({});

            await extraPriceService.updatePriceForGoodSkus(skus);

            expect(mockExtraGoodService.tradeSkusToServiceSkus).toHaveBeenCalledWith(skus, GoodServiceEnum.YANDEX);
            expect(mockExtraGoodService.tradeSkusToServiceSkus).toHaveBeenCalledWith(skus, GoodServiceEnum.WB);
        });

        it("should call updatePriceForService for each service with mapped SKUs", async () => {
            // Mock the services map
            extraPriceService["services"] = new Map();
            extraPriceService["services"].set(GoodServiceEnum.YANDEX, mockYandexPriceService);
            extraPriceService["services"].set(GoodServiceEnum.WB, mockWbPriceService);

            const skus = ["sku1", "sku2"];
            const mappedSkus1 = ["serviceSku1"];
            const mappedSkus2 = ["serviceSku2"];

            mockExtraGoodService.tradeSkusToServiceSkus.mockReturnValueOnce(mappedSkus1).mockReturnValueOnce(mappedSkus2);
            mockGoodService.updatePriceForService.mockResolvedValue({});

            await extraPriceService.updatePriceForGoodSkus(skus);

            expect(mockGoodService.updatePriceForService).toHaveBeenCalledWith(mockYandexPriceService, mappedSkus1);
            expect(mockGoodService.updatePriceForService).toHaveBeenCalledWith(mockWbPriceService, mappedSkus2);
        });

        it("should handle the case when no services are registered", async () => {
            // Set the services map to empty
            extraPriceService["services"] = new Map();

            const skus = ["sku1", "sku2"];
            await extraPriceService.updatePriceForGoodSkus(skus);

            expect(mockExtraGoodService.tradeSkusToServiceSkus).not.toHaveBeenCalled();
            expect(mockGoodService.updatePriceForService).not.toHaveBeenCalled();
        });
    });

    describe("updateAllPrices", () => {
        it("should call updateAllPrices on all services", async () => {
            // Устанавливаем сервисы напрямую
            extraPriceService["services"] = new Map();
            extraPriceService["services"].set(GoodServiceEnum.OZON, mockPriceService);
            extraPriceService["services"].set(GoodServiceEnum.WB, mockWbPriceService);

            mockPriceService.updateAllPrices.mockResolvedValue({});
            mockWbPriceService.updateAllPrices.mockResolvedValue({});

            await extraPriceService.updateAllPrices();

            expect(mockPriceService.updateAllPrices).toHaveBeenCalled();
            expect(mockWbPriceService.updateAllPrices).toHaveBeenCalled();
        });
    });

    describe("getWbCoeff", () => {
        it("should call getWbCategoryByName from goodService with the correct name", async () => {
            const name = "testName";
            const mockResponse: WbCommissionDto = {
                id: 1,
                name: "testName",
                commission: 10
            };

            mockGoodService.getWbCategoryByName.mockResolvedValue(mockResponse);

            const result = await extraPriceService.getWbCoeff(name);

            expect(mockGoodService.getWbCategoryByName).toHaveBeenCalledWith(name);
            expect(result).toBe(mockResponse);
        });
    });
});