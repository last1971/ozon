import { Test, TestingModule } from '@nestjs/testing';
import { PriceController } from './price.controller';
import { PriceService } from './price.service';
import { YandexPriceService } from '../yandex.price/yandex.price.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { WbPriceService } from '../wb.price/wb.price.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ExtraPriceService } from "./extra.price.service";

describe('PriceController', () => {
    let controller: PriceController;
    let extraPriceService: jest.Mocked<ExtraPriceService>;

    beforeEach(async () => {
        const mockExtraPriceService = {
            updateAllPercentsAndPrices: jest.fn(),
            getService: jest.fn(),
            optimizeOzonPrices: jest.fn(),
            getUnprofitableReport: jest.fn(),
        };

        const mockPriceService = {
            updateVat: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [PriceController],
            providers: [
                { provide: PriceService, useValue: mockPriceService },
                { provide: ExtraPriceService, useValue: mockExtraPriceService },
                { provide: YandexPriceService, useValue: {} },
                { provide: WbPriceService, useValue: {} },
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: ConfigService, useValue: { get: () => Object.values(GoodServiceEnum) } },
            ],
        }).compile();

        controller = module.get<PriceController>(PriceController);
        extraPriceService = module.get<ExtraPriceService>(ExtraPriceService) as jest.Mocked<ExtraPriceService>;
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('updateAllPercentsAndPrices', () => {
        it('should successfully update all percents and prices', async () => {
            extraPriceService.updateAllPercentsAndPrices.mockResolvedValue(undefined);

            const result = await controller.updateAllPercentsAndPrices();

            expect(extraPriceService.updateAllPercentsAndPrices).toHaveBeenCalled();
            expect(result).toEqual({
                success: true,
                message: 'Массовое обновление процентов и цен успешно выполнено',
            });
        });

        it('should handle errors and return error response', async () => {
            const error = new Error('Test error');
            extraPriceService.updateAllPercentsAndPrices.mockRejectedValue(error);

            const result = await controller.updateAllPercentsAndPrices();

            expect(extraPriceService.updateAllPercentsAndPrices).toHaveBeenCalled();
            expect(result).toEqual({
                success: false,
                message: 'Ошибка при массовом обновлении: Test error',
            });
        });

        it('should handle service returning undefined', async () => {
            extraPriceService.updateAllPercentsAndPrices.mockResolvedValue(undefined);

            const result = await controller.updateAllPercentsAndPrices();

            expect(result.success).toBe(true);
        });

        it('should handle service throwing with custom error message', async () => {
            const customError = new Error('Custom error message');
            extraPriceService.updateAllPercentsAndPrices.mockRejectedValue(customError);

            const result = await controller.updateAllPercentsAndPrices();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Ошибка при массовом обновлении: Custom error message');
        });
    });

    describe('updateVat', () => {
        it('should call getService and updateVat with correct parameters', async () => {
            const body = {
                service: GoodServiceEnum.OZON,
                offerIds: ['SKU123', 'SKU456'],
                vat: 20
            };
            const expectedResult = { success: true };
            const mockServiceUpdateVat = jest.fn().mockResolvedValue(expectedResult);
            extraPriceService.getService.mockReturnValue({ updateVat: mockServiceUpdateVat } as any);

            const result = await controller.updateVat(body);

            expect(extraPriceService.getService).toHaveBeenCalledWith(GoodServiceEnum.OZON);
            expect(mockServiceUpdateVat).toHaveBeenCalledWith(['SKU123', 'SKU456'], 20);
            expect(result).toEqual(expectedResult);
        });

        it('should handle empty offerIds array', async () => {
            const body = {
                service: GoodServiceEnum.WB,
                offerIds: [],
                vat: 0
            };
            const mockServiceUpdateVat = jest.fn().mockResolvedValue({ success: true });
            extraPriceService.getService.mockReturnValue({ updateVat: mockServiceUpdateVat } as any);

            await controller.updateVat(body);

            expect(mockServiceUpdateVat).toHaveBeenCalledWith([], 0);
        });

        it('should handle different VAT rates and services', async () => {
            const testCases = [
                { service: GoodServiceEnum.OZON, vat: 0, description: 'Ozon no VAT' },
                { service: GoodServiceEnum.WB, vat: 5, description: 'WB 5% VAT' },
                { service: GoodServiceEnum.YANDEX, vat: 20, description: 'Yandex 20% VAT' },
            ];

            for (const testCase of testCases) {
                const mockServiceUpdateVat = jest.fn();
                extraPriceService.getService.mockReturnValue({ updateVat: mockServiceUpdateVat } as any);

                const body = {
                    service: testCase.service,
                    offerIds: ['TEST'],
                    vat: testCase.vat
                };

                await controller.updateVat(body);

                expect(extraPriceService.getService).toHaveBeenCalledWith(testCase.service);
                expect(mockServiceUpdateVat).toHaveBeenCalledWith(['TEST'], testCase.vat);
            }
        });
    });

    describe('optimizeOzonPrices', () => {
        it('should successfully optimize prices', async () => {
            extraPriceService.optimizeOzonPrices.mockResolvedValue(undefined);

            const result = await controller.optimizeOzonPrices();

            expect(extraPriceService.optimizeOzonPrices).toHaveBeenCalled();
            expect(result).toEqual({
                success: true,
                message: 'Оптимизация цен Ozon успешно выполнена',
            });
        });

        it('should handle errors and return error response', async () => {
            const error = new Error('Optimization failed');
            extraPriceService.optimizeOzonPrices.mockRejectedValue(error);

            const result = await controller.optimizeOzonPrices();

            expect(extraPriceService.optimizeOzonPrices).toHaveBeenCalled();
            expect(result).toEqual({
                success: false,
                message: 'Ошибка при оптимизации: Optimization failed',
            });
        });
    });

    describe('getUnprofitableReport', () => {
        it('should return xlsx file with correct headers', async () => {
            const mockBuffer = Buffer.from('test xlsx content');
            extraPriceService.getUnprofitableReport.mockResolvedValue(mockBuffer as any);

            const mockResponse = {
                contentType: jest.fn().mockReturnThis(),
                attachment: jest.fn().mockReturnThis(),
                send: jest.fn().mockReturnThis(),
            };

            await controller.getUnprofitableReport(mockResponse as any);

            expect(extraPriceService.getUnprofitableReport).toHaveBeenCalled();
            expect(mockResponse.contentType).toHaveBeenCalledWith(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            expect(mockResponse.attachment).toHaveBeenCalledWith('unprofitable-ozon.xlsx');
            expect(mockResponse.send).toHaveBeenCalledWith(mockBuffer);
        });

        it('should call getUnprofitableReport on extraService', async () => {
            const mockBuffer = Buffer.from('test');
            extraPriceService.getUnprofitableReport.mockResolvedValue(mockBuffer as any);

            const mockResponse = {
                contentType: jest.fn().mockReturnThis(),
                attachment: jest.fn().mockReturnThis(),
                send: jest.fn().mockReturnThis(),
            };

            await controller.getUnprofitableReport(mockResponse as any);

            expect(extraPriceService.getUnprofitableReport).toHaveBeenCalledTimes(1);
        });
    });

});
