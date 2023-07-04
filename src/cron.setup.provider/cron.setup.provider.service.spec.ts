import { Test, TestingModule } from '@nestjs/testing';
import { CronSetupProviderService } from './cron.setup.provider.service';

describe('CronSetupProviderService', () => {
    let service: CronSetupProviderService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CronSetupProviderService],
        }).compile();

        service = module.get<CronSetupProviderService>(CronSetupProviderService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
