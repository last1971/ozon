import { Test, TestingModule } from '@nestjs/testing';
import { ElectronicaGoodService } from './electronica.good.service';
import { ElectronicaApiService } from '../electronica.api/electronica.api.service';

describe('ElectronicaGoodService', () => {
    let service: ElectronicaGoodService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ElectronicaGoodService,
                {
                    provide: ElectronicaApiService,
                    useValue: {
                        method: async () => ({
                            data: [{ GOODSCODE: 1, retailStore: { QUAN: 1 } }, { GOODSCODE: 2 }],
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<ElectronicaGoodService>(ElectronicaGoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('test', async () => {
        const response = await service.in(['1', '2']);
        expect(response).toEqual([
            { code: 1, name: '', quantity: 1, reserve: 0 },
            { code: 2, name: '', quantity: 0, reserve: 0 },
        ]);
    });
});
