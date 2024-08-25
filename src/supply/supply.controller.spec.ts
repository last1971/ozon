import { Test, TestingModule } from '@nestjs/testing';
import { SupplyController } from './supply.controller';
import { WbSupplyService } from '../wb.supply/wb.supply.service';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';

describe('SupplyController', () => {
    let controller: SupplyController;
    let app: INestApplication;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SupplyController],
            providers: [
                {
                    provide: WbSupplyService,
                    useValue: { getSupplies: jest.fn().mockReturnValue([{ id: 1, name: 'Supply1' }]) },
                },
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();

        controller = module.get<SupplyController>(SupplyController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    it('should return supplies for WB', async () => {
        const response = await request(app.getHttpServer()).get('/supply/list/wb').expect(200);
        expect(response.body).toEqual([{ id: 1, name: 'Supply1' }]);
    });
    it('should not return supplies for OZON', async () => {
        const response = await request(app.getHttpServer()).get('/supply/list/ozon').expect(200);
        expect(response.body).toEqual([]);
    });
});
