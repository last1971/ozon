import { Test, TestingModule } from '@nestjs/testing';
import { CronSetupProviderService } from './cron.setup.provider.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronTime } from 'cron';
import { cronConfig } from './cron.setup';

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

    /**
     * Страховка от тихой смерти нового крона: setupConJobs останавливает КАЖДУЮ джобу,
     * которой нет в cronConfig. Забыл внести — крон не отработает ни разу, и в логах
     * не будет даже намёка. Ловим это тестом, а не на проде.
     */
    it('каждый @Cron из кода внесён в cron.setup.ts', () => {
        const fs = require('fs');
        const path = require('path');
        const root = path.join(__dirname, '..');

        const walk = (dir: string): string[] =>
            fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: any) => {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) return walk(full);
                return entry.isFile() && full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
            });

        const names = new Set<string>();
        for (const file of walk(root)) {
            const source: string = fs
                .readFileSync(file, 'utf8')
                .split('\n')
                .filter((line: string) => !line.trim().startsWith('//'))
                .join('\n');
            for (const match of source.matchAll(/@Cron\([\s\S]*?name:\s*'([^']+)'[\s\S]*?\)/g)) {
                names.add(match[1]);
            }
        }

        expect(names.size).toBeGreaterThan(0);
        const missing = [...names].filter((name) => !(name in cronConfig));
        expect(missing).toEqual([]);
    });

    it('test setupConJobs', () => {
        service.setupConJobs();
        expect(stop.mock.calls).toHaveLength(3);
        expect(start.mock.calls).toHaveLength(2);
        expect(setTime.mock.calls).toHaveLength(2);
        expect(setTime.mock.calls[0]).toEqual([new CronTime('0 30 15 * * *')]);
    });
});
