import { Test, TestingModule } from '@nestjs/testing';
import { GoodController } from './good.controller';
import { GOOD_SERVICE } from '../interfaces/IGood';

describe('GoodController', () => {
    let controller: GoodController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [GoodController],
            providers: [{ provide: GOOD_SERVICE, useValue: {} }],
        }).compile();

        controller = module.get<GoodController>(GoodController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
