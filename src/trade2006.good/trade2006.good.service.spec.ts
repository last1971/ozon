import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006GoodService } from './trade2006.good.service';
import { FIREBIRD } from '../firebird/firebird.module';

describe('Trade2006GoodService', () => {
    let service: Trade2006GoodService;
    const query = jest.fn().mockReturnValue([{ GOODSCODE: 1, QUAN: 2 }]);

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [Trade2006GoodService, { provide: FIREBIRD, useValue: { query } }],
        }).compile();

        service = module.get<Trade2006GoodService>(Trade2006GoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test in', async () => {
        const res = await service.in(['1']);
        expect(res).toEqual([{ code: 1, quantity: 2 }]);
        expect(query.mock.calls[0]).toEqual([
            'SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE WHERE GOODS.GOODSCODE IN (?)',
            ['1'],
        ]);
    });
});
