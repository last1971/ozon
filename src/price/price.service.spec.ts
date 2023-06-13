import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service';
import { ProductService } from '../product/product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { ConfigService } from '@nestjs/config';

describe('PriceService', () => {
    let service: PriceService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceService,
                { provide: ProductService, useValue: {} },
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: ConfigService, useValue: {} },
            ],
        }).compile();

        service = module.get<PriceService>(PriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
