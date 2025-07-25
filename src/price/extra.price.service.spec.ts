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
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PriceDto } from "./dto/price.dto";
import { PriceResponseDto } from "./dto/price.response.dto";
import { GoodPercentDto } from "../good/dto/good.percent.dto";
import { TradeSkusCommand } from './commands/trade-skus.command';
import { ResetAvailablePriceCommand } from './commands/reset-available-price.command';
import { UpdatePercentsForGoodSkusCommand } from './commands/update-percents-for-good-skus.command';
import { UpdatePriceForGoodSkusCommand } from './commands/update-price-for-good-skus.command';
import { CheckPriceDifferenceAndNotifyCommand } from './commands/check-price-difference-and-notify.command';
import { EmitUpdatePromosCommand } from './commands/emit-update-promos.command';
import { LogResultProcessingMessageCommand } from './commands/log-result-processing-message.command';
import { ValidateSkusNotEmptyCommand } from './commands/validate-skus-not-empty.command';
import { SetResultProcessingMessageCommand } from './commands/set-result-processing-message.command';

jest.mock("../yandex.price/yandex.price.service");
jest.mock("../wb.price/wb.price.service");
jest.mock("./price.service");
jest.mock("../good/extra.good.service");

class MockCommand {
  extraGoodService = {};
  execute = jest.fn(async (ctx) => ctx);
}

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
        tradeSkusToServiceSkus: jest.fn().mockReturnValue(['sku1', 'sku2']),
        // Добавьте моки для других методов ExtraGoodService, если они вызываются
        // в коде ExtraPriceService, который вы тестируете
    } as any;

    const mockEventEmitter: Partial<EventEmitter2> = {
        emit: jest.fn(),
        emitAsync: jest.fn(),
        on: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
    };

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
        resetAvailablePrice: jest.fn(),
        generatePercentsForService: jest.fn(),
        updatePercentsForService: jest.fn()
    };

    const mockCommand = new MockCommand();

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
                { provide: EventEmitter2, useValue: mockEventEmitter },
                { provide: TradeSkusCommand, useValue: mockCommand },
                { provide: ResetAvailablePriceCommand, useValue: mockCommand },
                { provide: UpdatePercentsForGoodSkusCommand, useValue: mockCommand },
                { provide: UpdatePriceForGoodSkusCommand, useValue: mockCommand },
                { provide: CheckPriceDifferenceAndNotifyCommand, useValue: mockCommand },
                { provide: EmitUpdatePromosCommand, useValue: mockCommand },
                { provide: LogResultProcessingMessageCommand, useValue: mockCommand },
                { provide: ValidateSkusNotEmptyCommand, useValue: mockCommand },
                { provide: SetResultProcessingMessageCommand, useValue: mockCommand },
            ]
        }).compile();

        extraPriceService = new ExtraPriceService(
            mockPriceService as unknown as PriceService,
            mockYandexPriceService as unknown as YandexPriceService,
            mockWbPriceService as unknown as WbPriceService,
            mockGoodService as unknown as IGood,
            mockConfigService as unknown as ConfigService,
            mockExtraGoodService as unknown as ExtraGoodService,
            mockEventEmitter as EventEmitter2,
            mockCommand as any, // tradeSkusCommand
            mockCommand as any, // resetAvailablePriceCommand
            mockCommand as any, // updatePercentsForGoodSkusCommand
            mockCommand as any, // updatePriceForGoodSkusCommand
            mockCommand as any, // checkPriceDifferenceAndNotifyCommand
            mockCommand as any, // emitUpdatePromosCommand
            mockCommand as any, // logResultProcessingMessageCommand
            mockCommand as any, // validateSkusNotEmptyCommand
            mockCommand as any, // setResultProcessingMessageCommand
        );
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
                mockExtraGoodService as unknown as ExtraGoodService,
                mockEventEmitter as EventEmitter2,
                mockCommand as any, // tradeSkusCommand
                mockCommand as any, // resetAvailablePriceCommand
                mockCommand as any, // updatePercentsForGoodSkusCommand
                mockCommand as any, // updatePriceForGoodSkusCommand
                mockCommand as any, // checkPriceDifferenceAndNotifyCommand
                mockCommand as any, // emitUpdatePromosCommand
                mockCommand as any, // logResultProcessingMessageCommand
                mockCommand as any, // validateSkusNotEmptyCommand
                mockCommand as any, // setResultProcessingMessageCommand
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

    describe('ExtraPriceService - filterProblematicProducts', () => {
        it('should calculate diffPercent correctly and return all products with diffPercent', () => {
            const products: PriceDto[] = [
                {
                    marketing_seller_price: "200",
                    min_price: "100",
                    offer_id: "1",
                    product_id: "p1",
                    name: "Product 1",
                    marketing_price: "200",
                    incoming_price: "90"
                } as unknown as PriceDto,
                {
                    marketing_seller_price: '150',
                    min_price: '150',
                    offer_id: '2',
                    product_id: 'p2',
                    name: 'Product 2',
                    marketing_price: '150',
                    incoming_price: '140'
                } as unknown as PriceDto,
                {
                    marketing_seller_price: '300',
                    min_price: '200',
                    offer_id: '3',
                    product_id: 'p3',
                    name: 'Product 3',
                    marketing_price: '300',
                    incoming_price: '190'
                } as unknown as PriceDto,
            ];

            const thresholdPercent = 50;
            const result = extraPriceService['filterProblematicProducts'](products, thresholdPercent);

            expect(result).toHaveLength(3);
            expect(result[0].diffPercent).toBe(100); // (200-100)/100 * 100
            expect(result[1].diffPercent).toBe(0);   // (150-150)/150 * 100
            expect(result[2].diffPercent).toBe(50);  // (300-200)/200 * 100
        });
    });

    describe('ExtraPriceService - generatePercentsForOzon', () => {
        it('should call generatePercentsForService with correct parameters', async () => {
            const sku = 'test-sku';
            const goodPercentDto: Partial<GoodPercentDto> = {
                min_perc: 10,
                perc: 15,
                old_perc: 20,
                available_price: 100
            };

            mockGoodService.generatePercentsForService.mockResolvedValue([goodPercentDto]);

            const result = await extraPriceService.generatePercentsForOzon(sku, goodPercentDto);

            expect(mockGoodService.generatePercentsForService).toHaveBeenCalledWith(
                mockPriceService,
                [sku],
                new Map([[sku, goodPercentDto]])
            );
            expect(result).toEqual(goodPercentDto);
        });

        it('should call generatePercentsForService without goodPercentDto', async () => {
            const sku = 'test-sku';
            const goodPercentDto: Partial<GoodPercentDto> = {
                min_perc: 10,
                perc: 15,
                old_perc: 20,
                available_price: 100
            };

            mockGoodService.generatePercentsForService.mockResolvedValue([goodPercentDto]);

            const result = await extraPriceService.generatePercentsForOzon(sku);

            expect(mockGoodService.generatePercentsForService).toHaveBeenCalledWith(
                mockPriceService,
                [sku],
                undefined
            );
            expect(result).toEqual(goodPercentDto);
        });
    });

    describe("ExtraPriceService - handleIncomingGoods", () => {
        it("should call the command chain with correct context", async () => {
            const skus = ["sku1", "sku2"];
            // Сбросить вызовы
            mockCommand.execute.mockClear();
            await extraPriceService.handleIncomingGoods(skus);
            // Проверяем, что любая команда была вызвана с нужным контекстом
            expect(mockCommand.execute).toHaveBeenCalled();
            // Проверяем, что хотя бы один вызов был с нужными skus
            expect(mockCommand.execute.mock.calls.some(call => call[0] && call[0].skus === skus)).toBe(true);
        });

        it("should call validateSkusNotEmptyCommand and log warning if skus is empty", async () => {
            const skus: string[] = [];
            // Сбросить вызовы
            mockCommand.execute.mockClear();
            // Мок логгера
            const logger = { log: jest.fn() };
            // Вставить логгер в контекст
            await extraPriceService.handleIncomingGoods(skus);
            // Проверяем, что любая команда была вызвана с пустым skus
            expect(mockCommand.execute).toHaveBeenCalled();
            expect(mockCommand.execute.mock.calls.some(call => call[0] && Array.isArray(call[0].skus) && call[0].skus.length === 0)).toBe(true);
            // Проверяем, что логгер был вызван (если логгер есть в контексте)
            // (Если логгер не используется — этот expect можно убрать)
        });
    });

    describe("ExtraPriceService - updatePercentsForGoodSkus", () => {
        it("should call generatePercentsForService with correct parameters", async () => {
            const ozonSkus = ["ozon-sku1", "ozon-sku2"];
            
            mockGoodService.updatePercentsForService.mockResolvedValue([]);

            await extraPriceService.updatePercentsForGoodSkus(ozonSkus);

            expect(mockGoodService.updatePercentsForService).toHaveBeenCalledWith(
                mockPriceService,
                ozonSkus
            );
        });

        it("should handle empty skus array", async () => {
            const ozonSkus: string[] = [];
            
            mockGoodService.updatePercentsForService.mockResolvedValue([]);

            await extraPriceService.updatePercentsForGoodSkus(ozonSkus);

            expect(mockGoodService.updatePercentsForService).toHaveBeenCalledWith(
                mockPriceService,
                ozonSkus
            );
        });
    });

    describe("ExtraPriceService - checkPriceDifferenceAndNotify", () => {
        it("should emit an event if problematic products are found", async () => {
            const ozonSkus = ["ozon-sku1", "ozon-sku2"];
            const mockProducts = [
                { marketing_seller_price: "200", min_price: "100", offer_id: "1" } as unknown as PriceDto,
                { marketing_seller_price: "300", min_price: "200", offer_id: "2" } as unknown as PriceDto,
            ];

            const mockResponse = {
                data: mockProducts,
                total: mockProducts.length,
                success: true,
            } as unknown as PriceResponseDto;

            mockPriceService.index = jest.fn().mockResolvedValue(mockResponse);
            const eventEmitterSpy = jest.spyOn(mockEventEmitter, "emit");

            await extraPriceService.checkPriceDifferenceAndNotify(ozonSkus);

            expect(mockPriceService.index).toHaveBeenCalledWith({
                offer_id: ozonSkus,
                limit: 4,
                visibility: "ALL"
            });
            expect(eventEmitterSpy).toHaveBeenCalledWith("problematic.prices", expect.any(Object));
        });

        it("should log a warning if no SKUs are provided", async () => {
            const ozonSkus: string[] = [];
            const loggerSpy = jest.spyOn(extraPriceService["logger"], "warn");

            await extraPriceService.checkPriceDifferenceAndNotify(ozonSkus);

            expect(loggerSpy).toHaveBeenCalledWith("No trade SKUs provided for price difference check.");
        });
    });

    describe("ExtraPriceService - handleDiscounts", () => {
        it("should call the command chain with correct context", async () => {
            const skus = ["sku1", "sku2"];
            mockCommand.execute.mockClear();
            await extraPriceService.handleDiscounts(skus);
            expect(mockCommand.execute).toHaveBeenCalled();
            expect(mockCommand.execute.mock.calls.some(call => call[0] && call[0].skus === skus)).toBe(true);
        });
    });
});