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
    let priceService: jest.Mocked<PriceService>;

    beforeEach(async () => {
        const mockExtraPriceService = {
            updateAllPercentsAndPrices: jest.fn(),
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
        priceService = module.get<PriceService>(PriceService) as jest.Mocked<PriceService>;
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
        it('should call priceService.updateVat with correct parameters', async () => {
            const body = {
                offerIds: ['SKU123', 'SKU456'],
                vat: '0.2' as any
            };
            const expectedResult = { success: true };
            priceService.updateVat.mockResolvedValue(expectedResult);

            const result = await controller.updateVat(body);

            expect(priceService.updateVat).toHaveBeenCalledWith(['SKU123', 'SKU456'], '0.2');
            expect(result).toEqual(expectedResult);
        });

        it('should handle empty offerIds array', async () => {
            const body = {
                offerIds: [],
                vat: '0' as any
            };
            priceService.updateVat.mockResolvedValue({ success: true });

            await controller.updateVat(body);

            expect(priceService.updateVat).toHaveBeenCalledWith([], '0');
        });

        it('should handle different VAT rates', async () => {
            const testCases = [
                { vat: '0', description: 'no VAT' },
                { vat: '0.05', description: '5% VAT' },
                { vat: '0.1', description: '10% VAT' },
                { vat: '0.2', description: '20% VAT' },
            ];

            for (const testCase of testCases) {
                priceService.updateVat.mockClear();
                const body = {
                    offerIds: ['TEST'],
                    vat: testCase.vat as any
                };

                await controller.updateVat(body);

                expect(priceService.updateVat).toHaveBeenCalledWith(['TEST'], testCase.vat);
            }
        });
    });
});
