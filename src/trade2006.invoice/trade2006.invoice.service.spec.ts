import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006InvoiceService } from './trade2006.invoice.service';

describe('Trade2006InvoiceService', () => {
    let service: Trade2006InvoiceService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [Trade2006InvoiceService],
        }).compile();

        service = module.get<Trade2006InvoiceService>(Trade2006InvoiceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
