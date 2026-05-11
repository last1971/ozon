import { Test, TestingModule } from '@nestjs/testing';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';

describe('OrderController', () => {
    let controller: OrderController;
    const checkCanceledOrders = jest.fn();
    const runFboPackageForTesting = jest.fn();

    beforeEach(async () => {
        checkCanceledOrders.mockReset();
        runFboPackageForTesting.mockReset();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: OrderService, useValue: { runFboPackageForTesting } },
                { provide: YandexOrderService, useValue: {} },
                { provide: WbOrderService, useValue: {} },
                { provide: PostingFboService, useValue: { checkCanceledOrders } },
            ],
            controllers: [OrderController],
        }).compile();

        controller = module.get<OrderController>(OrderController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('updateOzonFboOrder', () => {
        it('вызывает PostingFboService.checkCanceledOrders и возвращает isSuccess', async () => {
            checkCanceledOrders.mockResolvedValueOnce(undefined);

            const result = await controller.updateOzonFboOrder();

            expect(checkCanceledOrders).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ isSuccess: true });
        });

        it('пробрасывает ошибку из PostingFboService', async () => {
            checkCanceledOrders.mockRejectedValueOnce(new Error('boom'));

            await expect(controller.updateOzonFboOrder()).rejects.toThrow('boom');
        });
    });

    describe('devRunFboPackage', () => {
        it('делегирует в OrderService.runFboPackageForTesting', async () => {
            const posting = { posting_number: 'TEST-001' } as any;
            runFboPackageForTesting.mockResolvedValueOnce({ id: 999 });

            const result = await controller.devRunFboPackage(posting);

            expect(runFboPackageForTesting).toHaveBeenCalledWith(posting);
            expect(result).toEqual({ id: 999 });
        });
    });
});
