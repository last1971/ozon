import { Test, TestingModule } from '@nestjs/testing';
import { ElectronicaGoodService } from './electronica.good.service';

describe('ElectronicaGoodService', () => {
    let service: ElectronicaGoodService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ElectronicaGoodService],
        }).compile();

        service = module.get<ElectronicaGoodService>(ElectronicaGoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
