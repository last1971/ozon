import { Test, TestingModule } from '@nestjs/testing';
import { WbApiService } from './wb.api.service';

describe('WbApiService', () => {
    let service: WbApiService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [WbApiService],
        }).compile();

        service = module.get<WbApiService>(WbApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
