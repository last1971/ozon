import { Test, TestingModule } from '@nestjs/testing';
import { SupplyController } from './supply.controller';
import { WbSupplyService } from '../wb.supply/wb.supply.service';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Trade2006InvoiceService } from "../trade2006.invoice/trade2006.invoice.service";
import { ProductService } from "../product/product.service";
import { StockType } from "../product/stock.type";
import { GoodServiceEnum } from '../good/good.service.enum';
import { NotFoundException } from '@nestjs/common';
import { WbCardService } from '../wb.card/wb.card.service';

describe('SupplyController', () => {
    let controller: SupplyController;
    let app: INestApplication;
    let productServices: ProductService;
    let invoiceService: Trade2006InvoiceService;
    let wbSupplyService: WbSupplyService;

    const mockProductServices = {
        get: jest.fn()
    };

    const mockInvoiceService = {
        getSupplyPositions: jest.fn()
    };

    const mockWbSupplyService = {
        getSupplyPositions: jest.fn()
    };

    const mockWbCardService = {
        // Пустой объект, так как в тестах мы не используем его методы
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SupplyController],
            providers: [
                {
                    provide: WbSupplyService,
                    useValue: { 
                        getSupplies: jest.fn().mockReturnValue([{ id: 1, name: 'Supply1' }]),
                        getSupplyPositions: mockWbSupplyService.getSupplyPositions
                    },
                },
                {
                    provide: Trade2006InvoiceService,
                    useValue: { 
                        getSupplies: jest.fn().mockReturnValue([{ id: 2, name: 'Supply2' }]),
                        getSupplyPositions: mockInvoiceService.getSupplyPositions
                    },
                },
                {
                    provide: ProductService,
                    useValue: mockProductServices
                },
                {
                    provide: WbCardService,
                    useValue: mockWbCardService
                }
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();

        controller = module.get<SupplyController>(SupplyController);
        productServices = module.get<ProductService>(ProductService);
        invoiceService = module.get<Trade2006InvoiceService>(Trade2006InvoiceService);
        wbSupplyService = module.get<WbSupplyService>(WbSupplyService);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    it('should return supplies', async () => {
        const response = await request(app.getHttpServer()).get('/supply/list').expect(200);
        expect(response.body).toEqual([{ id: 1, name: 'Supply1' }, { id: 2, name: 'Supply2' }]);
    });

    describe('getOrders', () => {
        const mockId = '123';
        const mockService = { name: 'test' };
        const mockPositions = [{ id: 1 }, { id: 2 }];

        it('should throw NotFoundException when service not found', async () => {
            await expect(controller.getOrders(
                mockId,
                StockType.FBO,
                GoodServiceEnum.EXPRESS,
            )).rejects.toThrow(NotFoundException);
        });

        it('should return FBO positions from invoice service', async () => {
            mockInvoiceService.getSupplyPositions.mockResolvedValue(mockPositions);

            const result = await controller.getOrders(
                mockId,
                StockType.FBO,
                GoodServiceEnum.WB
            );

            expect(result).toEqual(mockPositions);
            expect(mockInvoiceService.getSupplyPositions).toHaveBeenCalledWith(mockId, mockWbCardService);
        });

        it('should return positions from wb supply service for non-FBO type', async () => {
            mockWbSupplyService.getSupplyPositions.mockResolvedValue(mockPositions);

            const result = await controller.getOrders(
                mockId,
                StockType.FBS,
                GoodServiceEnum.WB
            );

            expect(result).toEqual(mockPositions);
            expect(mockWbSupplyService.getSupplyPositions).toHaveBeenCalledWith(mockId);
        });
    });
});
