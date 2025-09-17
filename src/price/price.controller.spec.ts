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
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [PriceController],
            providers: [
                { provide: PriceService, useValue: {} },
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
});
