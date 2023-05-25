import { Test, TestingModule } from '@nestjs/testing';
import { ElectronicaApiService } from './electronica.api.service';

describe('ElectronicaApiService', () => {
    let service: ElectronicaApiService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ElectronicaApiService],
        }).compile();

        service = module.get<ElectronicaApiService>(ElectronicaApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
