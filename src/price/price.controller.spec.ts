import { Test, TestingModule } from '@nestjs/testing';
import { PriceController } from './price.controller';
import { PriceService } from './price.service';
import { YandexPriceService } from '../yandex.price/yandex.price.service';
import { GOOD_SERVICE } from '../interfaces/IGood';

describe('PriceController', () => {
    let controller: PriceController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PriceController],
            providers: [
                { provide: PriceService, useValue: {} },
                { provide: YandexPriceService, useValue: {} },
                { provide: GOOD_SERVICE, useValue: {} },
            ],
        }).compile();

        controller = module.get<PriceController>(PriceController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
