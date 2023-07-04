import { Test, TestingModule } from '@nestjs/testing';
import { CronSetupProviderService } from './cron.setup.provider.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronTime } from 'cron';

describe('CronSetupProviderService', () => {
    let service: CronSetupProviderService;
    const start = jest.fn();
    const stop = jest.fn();
    const setTime = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CronSetupProviderService,
                {
                    provide: SchedulerRegistry,
                    useValue: {
                        getCronJobs: (): Map<string, any> =>
                            new Map([
                                ['testCase1', { start, stop, setTime }],
                                ['testCase2', { start, stop, setTime }],
                                ['testCase3', { start, stop, setTime }],
                                ['testCase4', { start, stop, setTime }],
                                ['testCase5', { start, stop, setTime }],
                            ]),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: { get: () => 'development' },
                },
            ],
        }).compile();

        service = module.get<CronSetupProviderService>(CronSetupProviderService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test setupConJobs', () => {
        service.setupConJobs();
        expect(stop.mock.calls).toHaveLength(3);
        expect(start.mock.calls).toHaveLength(2);
        expect(setTime.mock.calls).toHaveLength(2);
        expect(setTime.mock.calls[0]).toEqual([new CronTime('0 30 15 * * *')]);
    });
});
