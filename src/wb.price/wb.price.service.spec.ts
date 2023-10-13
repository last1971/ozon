import { Test, TestingModule } from '@nestjs/testing';
import { WbPriceService } from './wb.price.service';

describe('WbPriceService', () => {
    let service: WbPriceService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [WbPriceService],
        }).compile();

        service = module.get<WbPriceService>(WbPriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
