import { Test, TestingModule } from '@nestjs/testing';
import { OzonApiService } from './ozon.api.service';

describe('OzonApiService', () => {
    let service: OzonApiService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [OzonApiService],
        }).compile();

        service = module.get<OzonApiService>(OzonApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
