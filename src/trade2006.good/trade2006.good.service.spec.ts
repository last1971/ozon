import { Test, TestingModule } from "@nestjs/testing";
import { Trade2006GoodService } from "./trade2006.good.service";
import { FIREBIRD } from "../firebird/firebird.module";
import { ICountUpdateable } from "../interfaces/ICountUpdatebale";
import { ConfigService } from "@nestjs/config";
import { IPriceUpdateable } from "../interfaces/i.price.updateable";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Cache } from "@nestjs/cache-manager";
import { PriceCalculationHelper } from "../helpers/price/price.calculation.helper";
import { UpdatePriceDto } from "../price/dto/update.price.dto";
import { GoodPercentDto } from "../good/dto/good.percent.dto";

describe('Trade2006GoodService', () => {
    let service: Trade2006GoodService;
    const query = jest.fn().mockReturnValue([{ GOODSCODE: 1, QUAN: 2, RES: 1, PIECES: 1 }]);
    const execute = jest.fn();
    const get = jest.fn();
    const getProductsWithCoeffsFirst = {
        getSku: () => '1',
        getTransMaxAmount: () => 40,
        getSalesPercent: () => 10,
    };
    const getProductsWithCoeffs = jest.fn().mockResolvedValue([
        getProductsWithCoeffsFirst,
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

    const mockPriceCalculationHelper = {
        preparePricesContext: jest.fn().mockResolvedValue({
            codes: ['1'],
            goods: [{ code: 1, name: 'ONE', price: 10.11 }],
            percents: [{
                offer_id: '1',
                pieces: 1,
                perc: 20,
                adv_perc: 0,
                min_perc: 10,
                old_perc: 30,
                packing_price: 0,
                available_price: 0
            }],
            products: [
                {
                    getSku: () => '1',
                    getTransMaxAmount: () => 40,
                    getSalesPercent: () => 10
                }
            ]
        }),
        getIncomingPrice: jest.fn().mockReturnValue(10.11),
        adjustPercents: jest.fn().mockReturnValue({
            min_perc: 10,
            perc: 20,
            old_perc: 30
        })
    };

    const commit = jest.fn();

    beforeEach(async () => {
        query.mockReset().mockReturnValue([{ GOODSCODE: 1, QUAN: 2, RES: 1, PIECES: 1 }]);
        // Дефолтное поведение для всех методов helper-а
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            codes: ['1'],
            goods: [{ code: 1, name: 'ONE', price: 10.11 }],
            percents: [{
                offer_id: '1',
                pieces: 1,
                perc: 20,
                adv_perc: 0,
                min_perc: 10,
                old_perc: 30,
                packing_price: 0,
                available_price: 0
            }],
            products: [
                {
                    getSku: () => '1',
                    getTransMaxAmount: () => 40,
                    getSalesPercent: () => 10
                }
            ]
        });
        mockPriceCalculationHelper.getIncomingPrice.mockReturnValue(10.11);
        mockPriceCalculationHelper.adjustPercents.mockReturnValue({
            min_perc: 10,
            perc: 20,
            old_perc: 30
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006GoodService,
                { provide: FIREBIRD, useValue: { getTransaction: () => ({ query, execute, commit }) } },
                { provide: ConfigService, useValue: { get: () => null } },
                {
                    provide: EventEmitter2,
                    useValue: { emit },
                },
                {
                    provide: Cache,
                    useValue: { get },
                },
                {
                    provide: PriceCalculationHelper,
                    useValue: mockPriceCalculationHelper,
                },
            ],
        }).compile();

        emit.mockClear();
        query.mockClear();
        execute.mockClear();
        service = module.get<Trade2006GoodService>(Trade2006GoodService);
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockPriceCalculationHelper.preparePricesContext.mockReset();
        mockPriceCalculationHelper.getIncomingPrice.mockReset();
        mockPriceCalculationHelper.adjustPercents.mockReset();
    });


    afterAll(() => {
        jest.resetModules(); // Сбрасываем все модули после всех тестов
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
        const prices = new Map<string, UpdatePriceDto>();
        prices.set('1', { incoming_price: 100 } as UpdatePriceDto);
        
        await service.updatePriceForService(priceUdateable, ['1'], prices);
        expect(mockPriceCalculationHelper.preparePricesContext).toHaveBeenCalledWith(priceUdateable, ['1'], service);
        expect(mockPriceCalculationHelper.getIncomingPrice).toHaveBeenCalled();
        expect(updatePrices).toHaveBeenCalled();
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

    it('должен обнулять AVAILABLE_PRICE для всех товаров', async () => {
        const execute = jest.fn();

        // @ts-ignore - Игнорируем проверку типов для теста
        const existingTransaction = { execute };

        // @ts-ignore - Игнорируем проверку типов для теста
        await service.resetAvailablePrice(null, existingTransaction);

        expect(execute).toHaveBeenCalledWith(
            'UPDATE OZON_PERC SET AVAILABLE_PRICE = 0',
            []
        );
    });

    it('должен обнулять AVAILABLE_PRICE для указанных товаров', async () => {
        const execute = jest.fn();
        const goodCodes = ['100', '101', '102'];

        const existingTransaction = { execute };

        // @ts-expect-error Игнорируем несоответствие типов для теста
        await service.resetAvailablePrice(goodCodes, existingTransaction);

        expect(execute).toHaveBeenCalledWith(
            'UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (?,?,?)',
            goodCodes
        );
    });

    it('должен разбивать большой список товаров на пакеты', async () => {
        const execute = jest.fn();
        // Создаем массив из 100 кодов товаров
        const goodCodes = Array.from({ length: 100 }, (_, i) => `${i}`);

        const existingTransaction = {
            execute,
            commit: jest.fn(),
            db: {},
            isolation: 0,
            transaction: {},
            init: jest.fn(),
            rollback: jest.fn(),
            query: jest.fn(),
            inTransaction: true
        };

        await service.resetAvailablePrice(goodCodes, existingTransaction as any);

        // Должно быть 2 вызова (по 50 товаров в каждом)
        expect(execute).toHaveBeenCalledTimes(2);

        // Проверяем первый вызов с первыми 50 товарами
        const firstBatch = goodCodes.slice(0, 50);
        const placeholders1 = firstBatch.map(() => '?').join(',');
        expect(execute).toHaveBeenNthCalledWith(
            1,
            `UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (${placeholders1})`,
            firstBatch
        );

        // Проверяем второй вызов со следующими 50 товарами
        const secondBatch = goodCodes.slice(50, 100);
        const placeholders2 = secondBatch.map(() => '?').join(',');
        expect(execute).toHaveBeenNthCalledWith(
            2,
            `UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (${placeholders2})`,
            secondBatch
        );
    });

    it('должен использовать существующую транзакцию, если она предоставлена', async () => {
        const execute = jest.fn();
        const commit = jest.fn();
        const getTransaction = jest.fn();

        const existingTransaction = {
            execute,
            commit,
            query: jest.fn(),
            db: {},
            isolation: 0,
            transaction: {},
            init: jest.fn(),
            rollback: jest.fn(),
            inTransaction: true
        };

        const operation = jest.fn().mockImplementation(async (transaction) => {
            await transaction.execute('TEST QUERY', []);
            return 'TEST RESULT';
        });

        // Мокаем pool.getTransaction, но он не должен вызываться
        jest.spyOn(service['pool'], 'getTransaction').mockImplementation(getTransaction);

        const result = await service['withTransaction'](operation, existingTransaction as any);

        expect(getTransaction).not.toHaveBeenCalled();
        expect(operation).toHaveBeenCalled();
        expect(execute).toHaveBeenCalledWith('TEST QUERY', []);
        expect(commit).not.toHaveBeenCalled(); // Не должен коммитить существующую транзакцию
        expect(result).toBe('TEST RESULT');
    });

    it('должен обрабатывать ошибки и откатывать транзакцию', async () => {
        const execute = jest.fn();
        const commit = jest.fn();
        const rollback = jest.fn();
        const query = jest.fn();
        const getTransaction = jest.fn().mockResolvedValue({
            execute,
            commit,
            rollback,
            query,
            db: {},
            isolation: 0,
            transaction: {},
            init: jest.fn(),
            inTransaction: true
        });

        // Мокаем logger.error
        const loggerError = jest.fn();
        service['logger'] = { error: loggerError } as any;

        // Мокаем pool.getTransaction
        jest.spyOn(service['pool'], 'getTransaction').mockImplementation(getTransaction);

        const testError = new Error('Test error');
        const operation = jest.fn().mockImplementation(() => {
            throw testError;
        });

        await expect(service['withTransaction'](operation)).rejects.toThrow(testError);

        expect(getTransaction).toHaveBeenCalled();
        expect(operation).toHaveBeenCalled();
        expect(rollback).toHaveBeenCalledWith(true);
        expect(commit).not.toHaveBeenCalled();
        expect(loggerError).toHaveBeenCalledWith(testError.message);
    });

    it('updatePercentsForService with goodPercentsDto', async () => {
        // Предположим, что getSku() возвращает '1-1'
        const goodPercentsDto = new Map<string, Partial<GoodPercentDto>>();
        goodPercentsDto.set('1-1', { available_price: 150 });
    
        // Моки для preparePricesContext
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [{
                offer_id: 1,
                pieces: 1,
                adv_perc: 0,
                old_perc: 0,
                perc: 0,
                min_perc: 0,
                packing_price: 0,
                available_price: 0,
            }],
            products: [{
                getSku: () => '1-1',
                getTransMaxAmount: () => 0,
                getSalesPercent: () => 0,
            }]
        });
        mockPriceCalculationHelper.getIncomingPrice.mockReturnValue(100);
        mockPriceCalculationHelper.adjustPercents.mockReturnValue({
            min_perc: 10,
            perc: 20,
            old_perc: 30
        });
    
        // Мок для setPercents (если он вызывает execute)
        const setPercents = jest.spyOn(service, 'setPercents').mockResolvedValue(undefined);
    
        await service.updatePercentsForService(priceUdateable, ['1'], goodPercentsDto);
    
        expect(mockPriceCalculationHelper.preparePricesContext).toHaveBeenCalledWith(priceUdateable, ['1'], service);
        expect(mockPriceCalculationHelper.getIncomingPrice).toHaveBeenCalled();
        expect(mockPriceCalculationHelper.adjustPercents).toHaveBeenCalled();
        expect(setPercents).toHaveBeenCalled(); // Проверяем, что setPercents вызван
    });

    it('updatePercentsForService without goodPercentsDto', async () => {
        // Моки для preparePricesContext
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [{
                offer_id: 1,
                pieces: 1,
                adv_perc: 0,
                old_perc: 0,
                perc: 0,
                min_perc: 0,
                packing_price: 0,
                available_price: 0,
            }],
            products: [{
                getSku: () => '1-1',
                getTransMaxAmount: () => 0,
                getSalesPercent: () => 0,
            }]
        });
        mockPriceCalculationHelper.getIncomingPrice.mockReturnValue(100);
        mockPriceCalculationHelper.adjustPercents.mockReturnValue({
            min_perc: 10,
            perc: 20,
            old_perc: 30
        });

        // Мок для setPercents
        const setPercents = jest.spyOn(service, 'setPercents').mockResolvedValue(undefined);

        await service.updatePercentsForService(priceUdateable, ['1']);

        expect(mockPriceCalculationHelper.preparePricesContext).toHaveBeenCalledWith(priceUdateable, ['1'], service);
        expect(mockPriceCalculationHelper.getIncomingPrice).toHaveBeenCalled();
        expect(mockPriceCalculationHelper.adjustPercents).toHaveBeenCalled();
        expect(setPercents).toHaveBeenCalled(); // Проверяем, что setPercents вызван
    });


    it('generatePercentsForService without available_prices', async () => {
        const result = await service.generatePercentsForService(priceUdateable, ['1']);
        expect(mockPriceCalculationHelper.preparePricesContext).toHaveBeenCalledWith(priceUdateable, ['1'], service);
        expect(mockPriceCalculationHelper.getIncomingPrice).toHaveBeenCalled();
        expect(mockPriceCalculationHelper.adjustPercents).toHaveBeenCalled();
        expect(result).toEqual([{
            offer_id: '1',
            pieces: 1,
            perc: 20,
            adv_perc: 0,
            min_perc: 10,
            old_perc: 30,
            packing_price: 0,
            available_price: 0
        }]);
    });

    it('generatePercentsForService with available_prices', async () => {
        // Моки для preparePricesContext
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [{
                offer_id: '1',
                pieces: 1,
                adv_perc: 5,
                old_perc: 30,
                perc: 20,
                min_perc: 10,
                packing_price: 0,
                available_price: 150, // Указываем available_price
            }],
            products: [{
                getSku: () => '1',
                getTransMaxAmount: () => 40,
                getSalesPercent: () => 10,
            }]
        });
        mockPriceCalculationHelper.getIncomingPrice.mockReturnValue(100);
        mockPriceCalculationHelper.adjustPercents.mockReturnValue({
            min_perc: 10,
            perc: 20,
            old_perc: 30
        });

        // Вызов метода
        const result = await service.generatePercentsForService(priceUdateable, ['1']);

        // Проверки
        expect(mockPriceCalculationHelper.preparePricesContext).toHaveBeenCalledWith(priceUdateable, ['1'], service);
        expect(mockPriceCalculationHelper.getIncomingPrice).toHaveBeenCalled();
        expect(mockPriceCalculationHelper.adjustPercents).toHaveBeenCalled();
        expect(result).toEqual([{
            offer_id: '1',
            pieces: 1,
            perc: 20,
            adv_perc: 5,
            min_perc: 10,
            old_perc: 30,
            packing_price: 0,
            available_price: 150 // Проверяем, что available_price корректно обработан
        }]);
    });

    it('resetAvailablePrice', async () => {
        await service.resetAvailablePrice(['1', '2']);
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (?,?)',
            ['1', '2'],
        ]);
    });
});
