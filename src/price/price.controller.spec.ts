import { Test, TestingModule } from '@nestjs/testing';
import { PriceController } from './price.controller';
import { PriceService } from './price.service';
import { YandexPriceService } from '../yandex.price/yandex.price.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { WbPriceService } from '../wb.price/wb.price.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('PriceController', () => {
    let controller: PriceController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PriceController],
            providers: [
                { provide: PriceService, useValue: {} },
                { provide: YandexPriceService, useValue: {} },
                { provide: WbPriceService, useValue: {} },
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: ConfigService, useValue: { get: () => Object.values(GoodServiceEnum) } },
            ],
        }).compile();

        controller = module.get<PriceController>(PriceController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
