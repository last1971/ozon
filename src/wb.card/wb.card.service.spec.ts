import { Test, TestingModule } from '@nestjs/testing';
import { WbCardService } from './wb.card.service';

describe('WbCardService', () => {
    let service: WbCardService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [WbCardService],
        }).compile();

        service = module.get<WbCardService>(WbCardService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
