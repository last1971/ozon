import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006GoodService } from './trade2006.good.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';

describe('Trade2006GoodService', () => {
    let service: Trade2006GoodService;
    const query = jest.fn().mockReturnValue([{ GOODSCODE: 1, QUAN: 2, RES: 1 }]);
    const execute = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [Trade2006GoodService, { provide: FIREBIRD, useValue: { query, execute } }],
        }).compile();

        query.mockClear();
        service = module.get<Trade2006GoodService>(Trade2006GoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test in', async () => {
        const res = await service.in(['1']);
        expect(res).toEqual([{ code: 1, quantity: 2, reserve: 1 }]);
        expect(query.mock.calls[0]).toEqual([
            'SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN, (SELECT SUM(QUANSHOP) + SUM(QUANSKLAD) from RESERVEDPOS where GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE) AS RES  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE WHERE GOODS.GOODSCODE IN (?)',
            ['1'],
        ]);
    });
    it('test prices', async () => {
        await service.prices(['1', '2']);
        expect(query.mock.calls[0]).toEqual([
            'select g.goodscode, n.name, ( select sum(t.ost * t.price)/sum(t.ost) from (select price, quan -  COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) as ost  from pr_meta where pr_meta.goodscode=g.goodscode and pr_meta.shopincode is not null  and COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) < quan) t) as pric from goods g, name n where g.namecode=n.namecode and g.goodscode in (?,?)',
            ['1', '2'],
        ]);
    });
    it('test getPerc', async () => {
        await service.getPerc(['3']);
        expect(query.mock.calls[0]).toEqual(['select * from ozon_perc where goodscode in (?)', ['3']]);
    });
    it('test setPerc', async () => {
        await service.setPercents({ offer_id: '123', adv_perc: 10 });
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE OR INSERT INTO OZON_PERC (PERC_MIN, PERC_NOR, PERC_MAX, PERC_ADV, GOODSCODE, PIECES)VALUES (?,' +
                ' ?, ?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
            [null, null, null, 10, '123', 1],
        ]);
    });

    it('test getQuantities', async () => {
        const res = await service.getQuantities(['1']);
        expect(res).toEqual(new Map([['1', 1]]));
    });
    it('test updateCountForService', async () => {
        const updateGoodCounts = jest.fn().mockResolvedValueOnce(1);
        const getGoodIds = jest.fn().mockResolvedValueOnce({ goods: new Map([['1', 5]]) });
        const countUpdateable: ICountUpdateable = { updateGoodCounts, getGoodIds };
        const res = await service.updateCountForService(countUpdateable, '4');
        expect(res).toEqual(1);
        expect(updateGoodCounts.mock.calls[0]).toEqual([new Map([['1', 1]])]);
        expect(getGoodIds.mock.calls[0]).toEqual(['4']);
    });
});
