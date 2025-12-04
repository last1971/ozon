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
import { Logger } from "@nestjs/common";

describe('Trade2006GoodService', () => {
    let service: Trade2006GoodService;
    const query = jest.fn().mockReturnValue([{ GOODSCODE: 1, QUAN: 2, RES: 1, PIECES: 1 }]);
    const execute = jest.fn();
    const get = jest.fn();
    const set = jest.fn();
    const del = jest.fn();
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
                { provide: ConfigService, useValue: { get: (key: string, defaultValue?: any) => {
                    if (key === 'STORAGE_TYPE') return 'SHOPSKLAD';
                    if (key === 'FB_BATCH_SIZE') return defaultValue || 500;
                    return defaultValue || null;
                } } },
                {
                    provide: EventEmitter2,
                    useValue: { emit },
                },
                {
                    provide: Cache,
                    useValue: { get, set, del },
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
        expect(query.mock.calls[0][0].replace(/\s+/g, ' ').trim().toUpperCase()).toEqual(
            'SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN, ( SELECT SUM(QUANSHOP) + SUM(QUANSKLAD) FROM RESERVEDPOS WHERE GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE ) AS RES, NAME.NAME AS NAME FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE JOIN NAME ON GOODS.NAMECODE = NAME.NAMECODE WHERE GOODS.GOODSCODE IN (?)'
        );
        expect(query.mock.calls[0][1]).toEqual(['1']);
        expect(query.mock.calls[0][2]).toBe(true);
    });
    it('test prices', async () => {
        await service.prices(['1', '2']);
        expect(query.mock.calls[0][0].replace(/\s+/g, ' ').trim().toUpperCase()).toEqual(
            'SELECT G.GOODSCODE, N.NAME, CASE WHEN S.QUAN - COALESCE(R.RES, 0) > 0 THEN COALESCE( ( SELECT SUM(T.OST * T.PRICE) / NULLIF(SUM(T.OST), 0) FROM ( SELECT PM.PRICE, PM.QUAN - COALESCE((SELECT SUM(F.QUAN) FROM FIFO_T F WHERE F.PR_META_IN_ID = PM.ID), 0) AS OST FROM PR_META PM WHERE PM.GOODSCODE = G.GOODSCODE AND PM.SHOPINCODE IS NOT NULL AND COALESCE((SELECT SUM(F.QUAN) FROM FIFO_T F WHERE F.PR_META_IN_ID = PM.ID), 0) < PM.QUAN ) T ), (SELECT MAX(AVAILABLE_PRICE) FROM OZON_PERC WHERE GOODSCODE = G.GOODSCODE), (SELECT FIRST 1 PM2.PRICE FROM PR_META PM2 WHERE PM2.GOODSCODE = G.GOODSCODE AND PM2.SHOPINCODE IS NOT NULL ORDER BY PM2.DATA DESC), 1 ) ELSE NULL END AS PRIC FROM GOODS G JOIN NAME N ON G.NAMECODE = N.NAMECODE JOIN SHOPSKLAD S ON S.GOODSCODE = G.GOODSCODE LEFT JOIN ( SELECT GOODSCODE, SUM(QUANSHOP) + SUM(QUANSKLAD) AS RES FROM RESERVEDPOS GROUP BY GOODSCODE ) R ON R.GOODSCODE = G.GOODSCODE WHERE G.GOODSCODE IN (?,?)'
        );
        expect(query.mock.calls[0][1]).toEqual(['1', '2']);
        expect(query.mock.calls[0][2]).toBe(false);
    });
    it('test getPerc', async () => {
        await service.getPerc(['3']);
        expect(query.mock.calls[0]).toEqual(['select * from ozon_perc where goodscode in (?)', ['3'], false]);
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
    /*
    it('test updateCountForService', async () => {
        const updateGoodCounts = jest.fn().mockResolvedValueOnce(1);
        const getGoodIds = jest.fn().mockResolvedValueOnce({ goods: new Map([['1', 5]]) });
        const infoList = jest.fn();
        const loadSkuList = async () => {};
        const skuList = [];
        const countUpdateable: ICountUpdateable = { updateGoodCounts, getGoodIds, loadSkuList, skuList, infoList };
        // const res = await service.updateCountForService(countUpdateable, '4');
        // expect(res).toEqual(1);
        expect(updateGoodCounts.mock.calls[0]).toEqual([new Map([['1', 1]])]);
        expect(getGoodIds.mock.calls[0]).toEqual(['4']);
    });
    */
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
        // Настройка мока кэша - возвращаем null для всех ключей (кэш пустой)
        get.mockResolvedValue(null);
        
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
        expect(query.mock.calls[0][0].replace(/\s+/g, ' ').trim().toUpperCase()).toEqual(
            'SELECT GOODSCODE, SUM(QUAN) AS AMOUNT, COUNT(QUAN) AS QUAN, (SELECT BOUND_QUAN_SHOP FROM BOUND_QUAN WHERE BOUND_QUAN.GOODSCODE = PR_META.GOODSCODE) AS BOUND FROM PR_META WHERE (SHOPOUTCODE IS NOT NULL OR PODBPOSCODE IS NOT NULL OR REALPRICEFCODE IS NOT NULL) AND DATA >= ? AND DATA <= ? AND GOODSCODE IN (?,?) GROUP BY GOODSCODE'.toUpperCase()
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
        
        // Настройка мока кэша для второго вызова - возвращаем true для ключей, которые были записаны
        get.mockImplementation((key: string) => {
            if (key === 'half_store:2' || key === 'bound_check:2') {
                return Promise.resolve(true);
            }
            return Promise.resolve(null);
        });
        
        await service.checkBounds([
            { code: '1', name: '111', quantity: 1, reserve: 1 },
            { code: '2', name: '222', quantity: 2, reserve: null },
        ]);
        expect(emit.mock.calls).toHaveLength(2);
    });

    it('getWbData', async () => {
        await service.getWbData(['1', '3']);
        expect(query.mock.calls[0]).toEqual([
            `SELECT W.ID, W.TARIFF, W.MIN_PRICE, WC.COMMISSION
                 FROM WILDBERRIES W JOIN WB_CATEGORIES WC on WC.ID = W.WB_CATEGORIES_ID
                 WHERE W.ID IN ('1','3')`,
            [],
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
        // Создаем массив из 1000 кодов товаров (batch = 500)
        const goodCodes = Array.from({ length: 1000 }, (_, i) => `${i}`);

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

        // Должно быть 2 вызова (по 500 товаров в каждом)
        expect(execute).toHaveBeenCalledTimes(2);

        // Проверяем первый вызов с первыми 500 товарами
        const firstBatch = goodCodes.slice(0, 500);
        const placeholders1 = firstBatch.map(() => '?').join(',');
        expect(execute).toHaveBeenNthCalledWith(
            1,
            `UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (${placeholders1})`,
            firstBatch
        );

        // Проверяем второй вызов со следующими 500 товарами
        const secondBatch = goodCodes.slice(500, 1000);
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

        // Мокаем logger.error через spy
        const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

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

    it('generatePercentsForService returns empty array if products is empty', async () => {
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [{ offer_id: '1', pieces: 1, adv_perc: 0, old_perc: 0, perc: 0, min_perc: 0, packing_price: 0, available_price: 0 }],
            products: []
        });
        const result = await service.generatePercentsForService(priceUdateable, ['1']);
        expect(result).toEqual([]);
    });

    it('generatePercentsForService returns empty array if percents is empty', async () => {
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [],
            products: [{ getSku: () => '1', getTransMaxAmount: () => 0, getSalesPercent: () => 0 }]
        });
        const result = await service.generatePercentsForService(priceUdateable, ['1']);
        expect(result).toEqual([]);
    });

    it('generatePercentsForService uses percent values if goodPercentsDto does not contain sku', async () => {
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [{ offer_id: '1', pieces: 1, adv_perc: 5, old_perc: 30, perc: 20, min_perc: 10, packing_price: 0, available_price: 150 }],
            products: [{ getSku: () => '1', getTransMaxAmount: () => 40, getSalesPercent: () => 10 }]
        });
        mockPriceCalculationHelper.getIncomingPrice.mockReturnValue(100);
        mockPriceCalculationHelper.adjustPercents.mockReturnValue({ min_perc: 10, perc: 20, old_perc: 30 });
        const goodPercentsDto = new Map<string, Partial<GoodPercentDto>>(); // пустой
        const result = await service.generatePercentsForService(priceUdateable, ['1'], goodPercentsDto);
        expect(result).toEqual([{
            offer_id: '1',
            pieces: 1,
            perc: 20,
            adv_perc: 5,
            min_perc: 10,
            old_perc: 30,
            packing_price: 0,
            available_price: 150
        }]);
    });

    it('generatePercentsForService returns empty array if no percent passes filter', async () => {
        mockPriceCalculationHelper.preparePricesContext.mockResolvedValue({
            goods: [],
            percents: [{ offer_id: '1', pieces: 1, adv_perc: 0, old_perc: 0, perc: 0, min_perc: 0, packing_price: 0, available_price: 0 }],
            products: [{ getSku: () => '2', getTransMaxAmount: () => 0, getSalesPercent: () => 0 }]
        });
        mockPriceCalculationHelper.getIncomingPrice.mockReturnValue(0); // не проходит фильтр
        const result = await service.generatePercentsForService(priceUdateable, ['1']);
        expect(result).toEqual([]);
    });

    it('resetAvailablePrice', async () => {
        await service.resetAvailablePrice(['1', '2']);
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (?,?)',
            ['1', '2'],
        ]);
    });

    it('getAvitoData', async () => {
        query.mockReturnValue([
            { ID: 'avito123', GOODSCODE: '456', COEFF: 2, COMMISSION: 15.5 },
            { ID: 'avito789', GOODSCODE: '101', COEFF: 1, COMMISSION: 12.0 }
        ]);

        const result = await service.getAvitoData(['avito123', 'avito789']);

        expect(query).toHaveBeenCalledWith(
            `SELECT ID, GOODSCODE, COEFF, COMMISSION
                     FROM AVITO_GOOD
                     WHERE ID IN ('avito123','avito789')`,
            [],
            false
        );

        expect(result).toEqual([
            { id: 'avito123', goodsCode: '456', coeff: 2, commission: 15.5 },
            { id: 'avito789', goodsCode: '101', coeff: 1, commission: 12.0 }
        ]);
    });

    it('getAvitoData with chunks', async () => {
        const ids = Array.from({ length: 600 }, (_, i) => `avito${i}`);
        query.mockReturnValue([]);

        await service.getAvitoData(ids);

        // Should make 2 calls (500 + 100 items) with batchSize=500
        expect(query).toHaveBeenCalledTimes(2);

        // Check that inline values are used instead of ? placeholders
        expect(query).toHaveBeenNthCalledWith(1,
            expect.stringContaining(`WHERE ID IN ('avito0'`),
            [],
            false
        );
    });

    it('setAvitoData', async () => {
        const avitoData = {
            id: 'avito123',
            goodsCode: '456',
            coeff: 2,
            commission: 15.5
        };
        
        await service.setAvitoData(avitoData);
        
        expect(execute).toHaveBeenCalledWith(
            'UPDATE OR INSERT INTO AVITO_GOOD (ID, GOODSCODE, COEFF, COMMISSION) VALUES (?, ?, ?, ?) MATCHING (ID)',
            ['avito123', '456', 2, 15.5],
            false
        );
    });

    it('setAvitoData with transaction', async () => {
        const mockTransaction = { execute: jest.fn() };
        const avitoData = {
            id: 'avito456',
            goodsCode: '789',
            coeff: 1,
            commission: 10.0
        };
        
        await service.setAvitoData(avitoData, mockTransaction as any);
        
        expect(mockTransaction.execute).toHaveBeenCalledWith(
            'UPDATE OR INSERT INTO AVITO_GOOD (ID, GOODSCODE, COEFF, COMMISSION) VALUES (?, ?, ?, ?) MATCHING (ID)',
            ['avito456', '789', 1, 10.0],
            false
        );
        
        // Should not call the service's execute
        expect(execute).not.toHaveBeenCalled();
    });

    it('getAllAvitoIds', async () => {
        query.mockReturnValue([
            { ID: 'avito123', GOODSCODE: '456', COEFF: 2, COMMISSION: 15.5 },
            { ID: 'avito456', GOODSCODE: '789', COEFF: 1, COMMISSION: 10.0 },
            { ID: 'avito789', GOODSCODE: '101', COEFF: 1, COMMISSION: 12.0 },
        ]);

        const result = await service.getAllAvitoGoods();

        expect(query).toHaveBeenCalledWith('SELECT * FROM AVITO_GOOD', [], false);
        expect(result).toEqual([
            { id: 'avito123', goodsCode: '456', coeff: 2, commission: 15.5 },
            { id: 'avito456', goodsCode: '789', coeff: 1, commission: 10.0 },
            { id: 'avito789', goodsCode: '101', coeff: 1, commission: 12.0 },
        ]);
    });
});
