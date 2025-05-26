import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

describe('PerformanceController', () => {
    let controller: PerformanceController;
    let service: PerformanceService;

    const mockPerformanceService = {
        getTodayMoneySpent: jest.fn(),
        activateCampaign: jest.fn(),
        deactivateCampaign: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PerformanceController],
            providers: [
                {
                    provide: PerformanceService,
                    useValue: mockPerformanceService,
                },
            ],
        }).compile();

        controller = module.get<PerformanceController>(PerformanceController);
        service = module.get<PerformanceService>(PerformanceService);

        // Очищаем все моки перед каждым тестом
        jest.clearAllMocks();
    });

    describe('getTodayMoneySpent', () => {
        it('should return sum of money spent for today', async () => {
            const campaignIds = '123,456,789';
            const expectedResult = 1000;

            mockPerformanceService.getTodayMoneySpent.mockResolvedValue(expectedResult);

            const result = await controller.getTodayMoneySpent(campaignIds);

            expect(result).toBe(expectedResult);
            expect(service.getTodayMoneySpent).toHaveBeenCalledWith([123, 456, 789]);
        });

        it('should handle empty campaignIds', async () => {
            const campaignIds = '';
            const expectedResult = 0;

            mockPerformanceService.getTodayMoneySpent.mockResolvedValue(expectedResult);

            const result = await controller.getTodayMoneySpent(campaignIds);

            expect(result).toBe(expectedResult);
            expect(service.getTodayMoneySpent).toHaveBeenCalledWith([]);
        });
    });

    describe('activateCampaign', () => {
        it('should activate campaign successfully', async () => {
            const campaignId = '123456';
            const expectedResult = true;

            mockPerformanceService.activateCampaign.mockResolvedValue(expectedResult);

            const result = await controller.activateCampaign(campaignId);

            expect(result).toBe(expectedResult);
            expect(service.activateCampaign).toHaveBeenCalledWith(123456);
        });

        it('should handle activation failure', async () => {
            const campaignId = '123456';
            const expectedResult = false;

            mockPerformanceService.activateCampaign.mockResolvedValue(expectedResult);

            const result = await controller.activateCampaign(campaignId);

            expect(result).toBe(expectedResult);
            expect(service.activateCampaign).toHaveBeenCalledWith(123456);
        });
    });

    describe('deactivateCampaign', () => {
        it('should deactivate campaign successfully', async () => {
            const campaignId = '123456';
            const expectedResult = true;

            mockPerformanceService.deactivateCampaign.mockResolvedValue(expectedResult);

            const result = await controller.deactivateCampaign(campaignId);

            expect(result).toBe(expectedResult);
            expect(service.deactivateCampaign).toHaveBeenCalledWith(123456);
        });

        it('should handle deactivation failure', async () => {
            const campaignId = '123456';
            const expectedResult = false;

            mockPerformanceService.deactivateCampaign.mockResolvedValue(expectedResult);

            const result = await controller.deactivateCampaign(campaignId);

            expect(result).toBe(expectedResult);
            expect(service.deactivateCampaign).toHaveBeenCalledWith(123456);
        });
    });
}); 