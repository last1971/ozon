import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006GoodService } from './trade2006.good.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { ConfigService } from '@nestjs/config';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from '@nestjs/cache-manager';

describe('Trade2006GoodService', () => {
    let service: Trade2006GoodService;
    const query = jest.fn().mockReturnValue([{ GOODSCODE: 1, QUAN: 2, RES: 1, PIECES: 1 }]);
    const execute = jest.fn();
    const get = jest.fn();
    const getProductsWithCoeffs = jest.fn().mockResolvedValueOnce([
        {
            getSku: () => '1',
            getTransMaxAmount: () => 40,
            getSalesPercent: () => 10,
        },
    ]);
    const updatePrices = jest.fn();
    const priceUdateable: IPriceUpdateable = {
        getObtainCoeffs: () => ({
            minMil: 1,
            percMil: 5.5,
            percEkv: 1.5,
            sumObtain: 25,
            sumLabel: 10,
            taxUnit: 6,
        }),
        getProductsWithCoeffs,
        updatePrices,
        updateAllPrices: (): Promise<any> => null,
        createAction: (): Promise<any> => null,
    };
    const emit = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006GoodService,
                { provide: FIREBIRD, useValue: { getTransaction: () => ({ query, execute }) } },
                { provide: ConfigService, useValue: { get: () => null } },
                {
                    provide: EventEmitter2,
                    useValue: { emit },
                },
                {
                    provide: Cache,
                    useValue: { get },
                },
            ],
        }).compile();

        emit.mockClear();
        query.mockClear();
        execute.mockClear();
        service = module.get<Trade2006GoodService>(Trade2006GoodService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test in', async () => {
        const res = await service.in(['1']);
        expect(res).toEqual([{ code: 1, quantity: 2, reserve: 1 }]);
        expect(query.mock.calls[0]).toEqual([
            'SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN, (SELECT SUM(QUANSHOP) + SUM(QUANSKLAD) from RESERVEDPOS where GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE) AS RES, NAME.NAME AS NAME  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE JOIN NAME ON GOODS.NAMECODE = NAME.NAMECODE WHERE GOODS.GOODSCODE IN (?)',
            ['1'],
            true,
        ]);
    });
    it('test prices', async () => {
        await service.prices(['1', '2']);
        expect(query.mock.calls[0]).toEqual([
            'select g.goodscode, n.name, ( select sum(t.ost * t.price)/sum(t.ost) from (select price, quan -  COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) as ost  from pr_meta where pr_meta.goodscode=g.goodscode and pr_meta.shopincode is not null  and COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) < quan) t) as pric from goods g, name n where g.namecode=n.namecode and g.goodscode in (?,?)',
            ['1', '2'],
            true,
        ]);
    });
    it('test getPerc', async () => {
        await service.getPerc(['3']);
        expect(query.mock.calls[0]).toEqual(['select * from ozon_perc where goodscode in (?)', ['3'], true]);
    });
    it('test setPerc', async () => {
        await service.setPercents({ offer_id: '123', adv_perc: 10 });
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE OR INSERT INTO OZON_PERC (PERC_MIN, PERC_NOR, PERC_MAX, PERC_ADV, PACKING_PRICE,' +
            ' AVAILABLE_PRICE, GOODSCODE,' +
                ' PIECES)VALUES (?,' +
                ' ?, ?, ?, ?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
            [null, null, null, 10, null, 0, '123', 1],
            true,
        ]);
    });

    it('test getQuantities', async () => {
        const res = await service.getQuantities(['1']);
        expect(res).toEqual(new Map([['1', 1]]));
    });
    it('test updateCountForService', async () => {
        const updateGoodCounts = jest.fn().mockResolvedValueOnce(1);
        const getGoodIds = jest.fn().mockResolvedValueOnce({ goods: new Map([['1', 5]]) });
        const infoList = jest.fn();
        const loadSkuList = async () => {};
        const skuList = [];
        const countUpdateable: ICountUpdateable = { updateGoodCounts, getGoodIds, loadSkuList, skuList, infoList };
        const res = await service.updateCountForService(countUpdateable, '4');
        expect(res).toEqual(1);
        expect(updateGoodCounts.mock.calls[0]).toEqual([new Map([['1', 1]])]);
        expect(getGoodIds.mock.calls[0]).toEqual(['4']);
    });
    it('updateCountForSkus', async () => {
        const updateGoodCounts = jest.fn().mockResolvedValueOnce(2);
        const getGoodIds = jest.fn().mockResolvedValueOnce({
            goods: new Map([
                ['1', 5],
                ['2', 6],
            ]),
        });
        const loadSkuList = async () => {};
        const infoList = jest.fn();
        const skuList = [];
        const countUpdateable: ICountUpdateable = { updateGoodCounts, getGoodIds, loadSkuList, skuList, infoList };
        const res = await service.updateCountForSkus(countUpdateable, ['1', '2']);
        expect(res).toEqual(2);
        expect(updateGoodCounts.mock.calls[0]).toEqual([
            new Map([
                ['1', 1],
                ['2', 0],
                ['1-1', 1],
            ]),
        ]);
    });
    it('updatePriceForService', async () => {
        query
            .mockResolvedValueOnce([{ GOODSCODE: 1, NAME: 'ONE', PRIC: 10.11 }])
            .mockResolvedValueOnce([
                { GOODSCODE: 1, PIECES: 1, PERC_NOR: 20, PERC_ADV: 0, PERC_MIN: 10, PERC_MAX: 30, PACKING_PRICE: 0 },
            ]);
        await service.updatePriceForService(priceUdateable, ['1']);
        expect(query.mock.calls).toHaveLength(2);
        expect(getProductsWithCoeffs.mock.calls[0]).toEqual([['1']]);
        expect(updatePrices.mock.calls[0]).toEqual([
            [
                {
                    auto_action_enabled: 'ENABLED',
                    currency_code: 'RUB',
                    incoming_price: 10.11,
                    min_price: '112',
                    offer_id: '1',
                    old_price: '115',
                    price: '114',
                    price_strategy_enabled: 'DISABLED',
                    sum_pack: 0,
                },
            ],
        ]);
    });

    it('checkCounts', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: '111' }, { GOODSCODE: '222' }]);
        get.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await service.checkCounts();
        expect(query.mock.calls[0]).toEqual(['SELECT GOODSCODE FROM GOODSCOUNTCHANGE WHERE CHANGED=1', [], true]);
        expect(emit.mock.calls[0]).toEqual(['counts.changed', [{ code: 1, quantity: 2, reserve: 1 }]]);
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE GOODSCOUNTCHANGE SET CHANGED=0 WHERE GOODSCODE IN (?,?)',
            ['111', '222'],
            true,
        ]);
        const res = await service.checkCounts();
        expect(res).toHaveLength(0);
    });

    it('checkBounds', async () => {
        query
            .mockResolvedValueOnce([
                { QUAN: 1, AMOUNT: 1, BOUND: null, GOODSCODE: '1' },
                { QUAN: 2, AMOUNT: 10, BOUND: 5, GOODSCODE: '2' },
            ])
            .mockResolvedValueOnce([
                { QUAN: 1, AMOUNT: 1, BOUND: null, GOODSCODE: '1' },
                { QUAN: 2, AMOUNT: 10, BOUND: 5, GOODSCODE: '2' },
            ]);
        await service.checkBounds([
            { code: '1', name: '111', quantity: 1, reserve: 1 },
            { code: '2', name: '222', quantity: 2, reserve: null },
        ]);
        expect(query.mock.calls[0][0]).toEqual(
            'select goodscode, sum(quan) as amount, count(quan) as quan, (select bound_quan_shop from bound_quan' +
                ' where bound_quan.goodscode=pr_meta.goodscode) as bound from pr_meta where (shopoutcode is not null or podbposcode is not null or realpricefcode is not null) and data >= ?  and data <= ? and goodscode in (?,?) group by goodscode',
        );
        expect(emit.mock.calls[0]).toEqual([
            'half.store',
            { code: '2', name: '222', quantity: 2, reserve: null },
            { QUAN: 2, AMOUNT: 10, BOUND: 5, GOODSCODE: '2' },
        ]);
        expect(emit.mock.calls[1]).toEqual([
            'bound.check',
            { code: '2', name: '222', quantity: 2, reserve: null },
            { QUAN: 2, AMOUNT: 10, BOUND: 5, GOODSCODE: '2' },
        ]);
        await service.checkBounds([
            { code: '1', name: '111', quantity: 1, reserve: 1 },
            { code: '2', name: '222', quantity: 2, reserve: null },
        ]);
        expect(emit.mock.calls).toHaveLength(2);
    });

    it('getWbData', async () => {
        await service.getWbData(['1', '3']);
        expect(query.mock.calls[0]).toEqual([
            'SELECT W.ID, W.TARIFF, W.MIN_PRICE, WC.COMMISSION\n                 FROM WILDBERRIES W JOIN' +
                ' WB_CATEGORIES WC on WC.ID = W.WB_CATEGORIES_ID\n                 WHERE W.ID IN (?,?)',
            ['1', '3'],
            true,
        ]);
    });

    it('setWbData', async () => {
        await service.setWbData({
            commission: 1,
            id: '3',
            tariff: 5,
            wbCategoriesId: 7,
        });
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE OR INSERT INTO WILDBERRIES (COMMISSION,ID,TARIFF,WB_CATEGORIES_ID) VALUES (?,?,?,?) MATCHING (ID)',
            [1, '3', 5, 7],
            true,
        ]);
    });
    it('updateWbCategory', async () => {
        await service.updateWbCategory({
            nmID: 1,
            sizes: [],
            subjectID: 2,
            subjectName: '3',
            vendorCode: '4',
            photos: [],
            title: 'test'
        });
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE OR INSERT INTO WB_CATEGORIES (ID, COMMISSION, NAME) VALUES (?, ?, ?) MATCHING (ID)',
            [2, 25, '3'],
            true,
        ]);
    });
    it('getWbCategoryByName', async () => {
        await service.getWbCategoryByName('test');
        expect(query.mock.calls[0]).toEqual(['SELECT * FROM WB_CATEGORIES WHERE NAME = ?', ['test'], true]);
    });
});
