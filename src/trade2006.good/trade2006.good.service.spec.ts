import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006GoodService } from './trade2006.good.service';

describe('Trade2006GoodService', () => {
    let service: Trade2006GoodService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [Trade2006GoodService],
        }).compile();

        service = module.get<Trade2006GoodService>(Trade2006GoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
