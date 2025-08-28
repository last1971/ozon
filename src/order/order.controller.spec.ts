import { Test, TestingModule } from '@nestjs/testing';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';

describe('OrderController', () => {
    let controller: OrderController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: OrderService, useValue: {} },
                { provide: YandexOrderService, useValue: {} },
                { provide: WbOrderService, useValue: {} },
                { 
                    provide: INVOICE_SERVICE, 
                    useValue: {
                        getTransaction: jest.fn().mockResolvedValue({})
                    } 
                },
            ],
            controllers: [OrderController],
        }).compile();

        controller = module.get<OrderController>(OrderController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
