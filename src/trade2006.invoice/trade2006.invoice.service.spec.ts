import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006InvoiceService } from './trade2006.invoice.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { Cache } from '@nestjs/cache-manager';
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";
import { InvoiceDto } from "../invoice/dto/invoice.dto";

describe('Trade2006InvoiceService', () => {
    let service: Trade2006InvoiceService;
    const query = jest.fn();
    const execute = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const get = jest.fn();
    const emit = jest.fn();
    const set = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006InvoiceService,
                {
                    provide: FIREBIRD,
                    useValue: {
                        getTransaction: () => ({
                            query,
                            execute,
                            commit,
                            rollback,
                        }),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: { 
                        get: (key: string, defaultValue?: any) => {
                            if (key === 'STORAGE_TYPE') return defaultValue || 'SHOPSKLAD';
                            return get(key, defaultValue);
                        }
                    },
                },
                {
                    provide: EventEmitter2,
                    useValue: { emit },
                },
                {
                    provide: Cache,
                    useValue: { set },
                },
            ],
        }).compile();

        execute.mockClear();
        query.mockClear();
        commit.mockClear();
        rollback.mockClear();
        get.mockClear();
        emit.mockClear();
        service = module.get<Trade2006InvoiceService>(Trade2006InvoiceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('getTransaction', async () => {
        const transaction = await service.getTransaction();
        expect(transaction).toEqual({
            query,
            execute,
            commit,
            rollback,
        });
    });

    it('test create', async () => {
        get.mockReturnValueOnce(1).mockReturnValueOnce(2);
        query
            .mockResolvedValueOnce([{ MAX: 1, SUMMAP: 1, SCODE: 2, PRIM: '2-2' }])
            .mockResolvedValueOnce([{ GEN_ID: 2 }])
            .mockRejectedValueOnce({ message: 'Test error' });
        const date = new Date();
        let res = await service.create({
            buyerId: 1,
            remark: 'test remark',
            date,
            invoiceLines: [
                {
                    goodCode: '1',
                    quantity: 2,
                    price: '3.33',
                },
            ],
        });
        expect(res).toBeTruthy();
        expect(query.mock.calls[0]).toEqual([
            'SELECT MAX(NS) FROM S WHERE FIRM_ID = ? AND DATA >= ?',
            [1, DateTime.now().startOf('year').toISODate()],
        ]);
        expect(query.mock.calls[1]).toEqual(['SELECT GEN_ID(SCODE_GEN, 0) from rdb$database', []]);
        expect(execute.mock.calls).toHaveLength(3);
        expect(commit.mock.calls).toHaveLength(1);
        expect(rollback.mock.calls).toHaveLength(0);
        res = await service.create({
            buyerId: 1,
            remark: 'test remark',
            date,
            invoiceLines: [
                {
                    goodCode: '1',
                    quantity: 2,
                    price: '3.33',
                },
            ],
        });
        expect(res).toBeFalsy();
        expect(rollback.mock.calls).toHaveLength(1);
    });

    it('getTransferOutLines - found', async () => {
        const mockRecords = [
            {
                REALPRICEFCODE: 1,
                SFCODE: 123,
                GOODSCODE: 456,
                PRICE: 100.50,
                QUAN: 5,
                OPRIH: 1,
                REALPRICECODE: 789,
                DIRECTSKLADNEED: 0,
                DIRECTSHOPNEED: 0,
                DIRECTSHOP: 0,
                DIRECTSKLAD: 0,
                GTD: 'GTD123',
                STRANA: 'Russia',
                SUMMAP: 502.50,
                SECONDINSERT: 0,
                MARK1C: 0,
                USERNAME: 'test_user',
                SHOP_SALED_NAKL_D_ID: 0,
                INSERT_ATTR: 'test_insert',
                MODIFY_ATTR: 'test_modify'
            },
            {
                REALPRICEFCODE: 2,
                SFCODE: 123,
                GOODSCODE: 789,
                PRICE: 200.00,
                QUAN: 2,
                OPRIH: 1,
                REALPRICECODE: 790,
                DIRECTSKLADNEED: 0,
                DIRECTSHOPNEED: 0,
                DIRECTSHOP: 0,
                DIRECTSKLAD: 0,
                GTD: 'GTD456',
                STRANA: 'Germany',
                SUMMAP: 400.00,
                SECONDINSERT: 0,
                MARK1C: 0,
                USERNAME: 'test_user',
                SHOP_SALED_NAKL_D_ID: 0,
                INSERT_ATTR: 'test_insert',
                MODIFY_ATTR: 'test_modify'
            }
        ];
        query.mockResolvedValueOnce(mockRecords);

        const result = await service.getTransferOutLines(123);

        expect(result).toBeDefined();
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[0].transferOutId).toBe(123);
        expect(result[0].goodId).toBe(456);
        expect(result[0].price).toBe(100.50);
        expect(result[0].quantity).toBe(5);
        expect(result[0].totalAmount).toBe(502.50);
        expect(result[1].id).toBe(2);
        expect(result[1].goodId).toBe(789);
        expect(result[1].price).toBe(200.00);
        expect(query).toHaveBeenCalledWith(
            'SELECT * FROM REALPRICEF WHERE SFCODE = ?',
            [123]
        );
    });

    it('getTransferOutLines - empty', async () => {
        query.mockResolvedValueOnce([]);

        const result = await service.getTransferOutLines(999);

        expect(result).toBeDefined();
        expect(result).toHaveLength(0);
        expect(query).toHaveBeenCalledWith(
            'SELECT * FROM REALPRICEF WHERE SFCODE = ?',
            [999]
        );
    });

    it('updateTransferOutLinesAmounts - success', async () => {
        const mockLines = [
            {
                id: 1,
                transferOutId: 123,
                goodId: '456',
                price: 100.00,
                quantity: 2,
                totalAmount: 250.00,
                operationType: 1,
                invoiceLineId: 10,
                directWarehouseNeed: 0,
                directShopNeed: 0,
                directShop: 0,
                directWarehouse: 0,
                gtd: '',
                country: '',
                secondInsert: 0,
                mark1c: 0,
                username: '',
                shopSaledNaklDId: 0,
                insertAttr: '',
                modifyAttr: ''
            },
            {
                id: 2,
                transferOutId: 123,
                goodId: '789',
                price: 150.00,
                quantity: 1,
                totalAmount: 150.00,
                operationType: 1,
                invoiceLineId: 11,
                directWarehouseNeed: 0,
                directShopNeed: 0,
                directShop: 0,
                directWarehouse: 0,
                gtd: '',
                country: '',
                secondInsert: 0,
                mark1c: 0,
                username: '',
                shopSaledNaklDId: 0,
                insertAttr: '',
                modifyAttr: ''
            }
        ];

        await service.updateTransferOutLinesAmounts(mockLines);

        // Проверяем обновления строк УПД
        expect(execute).toHaveBeenCalledWith(
            'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
            [250.00, 1]
        );
        expect(execute).toHaveBeenCalledWith(
            'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
            [150.00, 2]
        );

        // Проверяем обновления строк счета
        expect(execute).toHaveBeenCalledWith(
            'UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?',
            [250.00, 10]
        );
        expect(execute).toHaveBeenCalledWith(
            'UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?',
            [150.00, 11]
        );
    });

    it('updateTransferOutLinesAmounts - without invoice lines', async () => {
        const mockLines = [
            {
                id: 1,
                transferOutId: 123,
                goodId: '456',
                price: 100.00,
                quantity: 2,
                totalAmount: 250.00,
                operationType: 1,
                invoiceLineId: null,
                directWarehouseNeed: 0,
                directShopNeed: 0,
                directShop: 0,
                directWarehouse: 0,
                gtd: '',
                country: '',
                secondInsert: 0,
                mark1c: 0,
                username: '',
                shopSaledNaklDId: 0,
                insertAttr: '',
                modifyAttr: ''
            }
        ];

        await service.updateTransferOutLinesAmounts(mockLines);

        // Проверяем обновление только строки УПД
        expect(execute).toHaveBeenCalledWith(
            'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
            [250.00, 1]
        );

        // Проверяем что строка счета не обновлялась
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('test isExists', async () => {
        query
            .mockResolvedValueOnce([
                {
                    PRIM: 'test1',
                    POKUPATCODE: 1,
                    SCODE: 2,
                    DATA: '2020-01-01',
                    STATUS: 0,
                },
            ])
            .mockResolvedValueOnce([]);
        let res = await service.isExists('test1');
        expect(res).toBeTruthy();
        res = await service.isExists('test2');
        expect(res).toBeFalsy();
    });
    it('test getByPosting', async () => {
        query.mockResolvedValueOnce([
            {
                PRIM: 'test1',
                POKUPATCODE: 1,
                SCODE: 2,
                DATA: '2020-01-01',
                STATUS: 0,
            },
        ]);
        const res = await service.getByPosting({
            posting_number: 'test1',
            status: 'string',
            in_process_at: 'string',
            products: [],
        });
        expect(res).toEqual({
            id: 2,
            buyerId: 1,
            date: '2020-01-01',
            remark: 'test1',
            status: 0,
            number: undefined,
            barcode: undefined,
            assemblyStart: undefined,
            assemblyEnd: undefined,
        });
    });
    it('Test pickupInvoice', async () => {
        await service.pickupInvoice({ id: 1, date: new Date(), remark: '1', buyerId: 1, status: 3 });
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE PODBPOS SET QUANSHOP= QUANSHOPNEED WHERE SCODE = ?',
            [1],
            true,
        ]);
    });
    it('test getByPostingNumbers', async () => {
        query.mockReturnValueOnce([]);
        await service.getByPostingNumbers(['1', '2', '3']);
        expect(query.mock.calls[0]).toEqual([
            'SELECT *\n                 FROM S\n                 WHERE PRIM IN' + ' (?,?,?)',
            ['1', '2', '3'],
            true,
        ]);
    });
    it('test bulkSetStatus', async () => {
        await service.bulkSetStatus([{ id: 1, status: 1, buyerId: 1, remark: '1', date: new Date() }], 3);
        expect(execute.mock.calls[0]).toEqual(['UPDATE S SET STATUS = ? WHERE SCODE IN (?)', [3, 1], false]);
        expect(commit.mock.calls).toHaveLength(1);
    });
    it('test upsertInvoiceCashFlow', async () => {
        await service.upsertInvoiceCashFlow({ id: 1, status: 1, buyerId: 1, remark: '1', date: new Date() }, 111.11);
        expect(execute.mock.calls[0][0]).toEqual(
            'UPDATE OR INSERT INTO SCHET (MONEYSCHET, NS, DATA, POKUPATCODE, SCODE) VALUES (?, ?, ?, ?, ?) MATCHING (SCODE)',
        );
        expect(execute.mock.calls[0][1][0]).toEqual(111.11);
    });
    it('test setInvoiceAmount', async () => {
        query.mockReturnValueOnce([{ SUMMAP: 1 }]);
        await service.setInvoiceAmount({ id: 1, status: 1, buyerId: 1, remark: '1', date: new Date() }, 111.11);
        expect(query.mock.calls[0]).toEqual(['SELECT * FROM REALPRICE WHERE SCODE = ?', [1]]);
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?',
            [111.11, undefined],
        ]);
    });
    it('test createTransferOut', async () => {
        get.mockReturnValueOnce(1);
        await service.createTransferOut({ id: 1, status: 1, buyerId: 1, remark: '1', date: new Date() });
        expect(execute.mock.calls[0]).toEqual([
            'EXECUTE PROCEDURE CREATESF9 (?, ?, ?, ?, ?)',
            [null, 1, 1, null, 0],
            true,
        ]);
    });
    it('test updateByTransactions', async () => {
        query.mockReturnValue([{ SCODE: 2, PRIM: '2-2', STATUS: 4 }]);
        await service.updateByTransactions([{ posting_number: '2-2', amount: 111.11 }]);
        expect(query.mock.calls).toHaveLength(3);
        expect(query.mock.calls[0]).toEqual([
            'SELECT *\n                 FROM S\n                 WHERE PRIM IN' + ' (?)',
            ['2-2'],
            true,
        ]);
        expect(query.mock.calls[1]).toEqual([
            'SELECT *\n                 FROM S\n                 WHERE PRIM IN' + ' (?)',
            ['2-2'],
            true,
        ]);
        expect(query.mock.calls[2]).toEqual(['SELECT * FROM REALPRICE WHERE SCODE = ?', [2]]);
        expect(execute.mock.calls).toHaveLength(5);
        expect(set.mock.calls).toEqual([
            ['updateByTransactions', true, 0],
            ['updateByTransactions', false, 0],
        ]);
    });
    it('createInvoiceFromPostingDto', async () => {
        const date = new Date();
        const posting = {
            posting_number: '321',
            status: 'string',
            in_process_at: date.toISOString(),
            products: [
                {
                    price: '1.11',
                    offer_id: '444',
                    quantity: 2,
                },
            ],
        };
        query
            .mockResolvedValueOnce([{ MAX: 1, SUMMAP: 1, SCODE: 2, PRIM: '2-2' }])
            .mockResolvedValueOnce([{ GEN_ID: 3 }]);
        const res = await service.createInvoiceFromPostingDto(1111, posting);
        expect(res).toEqual({
            buyerId: 1111,
            date: date,
            id: 3,
            invoiceLines: [{ goodCode: '444', originalCode: '444', price: '1.11', quantity: 2 }],
            remark: '321',
            status: 3,
        });
        expect(emit.mock.calls[0]).toEqual(['reserve.created', ['444']]);
    });
    it('getByBuyerAndStatus', async () => {
        query.mockResolvedValueOnce([]);
        await service.getByBuyerAndStatus(1, 2);
        expect(query.mock.calls[0]).toEqual(['SELECT * FROM S WHERE POKUPATCODE = ? AND STATUS = ?', [1, 2], true]);
    });
    it('updateByCommissions', async () => {
        get.mockReturnValueOnce(1).mockReturnValueOnce(2);
        query
            .mockResolvedValueOnce([
                { SCODE: 1, NS: '1', STATUS: 4, POKUPATCODE: 1, DATA: '2020-11-11', PRIM: '120' },
                { SCODE: 2, NS: '2', STATUS: 4, POKUPATCODE: 2, DATA: '2020-12-12', PRIM: '121' },
            ])
            .mockResolvedValueOnce([{ REALPRICECODE: '1', SUMMAP: 99 }])
            .mockResolvedValueOnce([{ REALPRICECODE: '2', SUMMAP: 100 }]);
        await service.updateByCommissions(
            new Map([
                ['120', 120],
                ['121', 121],
            ]),
        );
        expect(execute.mock.calls).toHaveLength(9);
        expect(commit.mock.calls).toHaveLength(1);
        expect(execute.mock.calls[0]).toEqual(['UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?', [120, '1']]);
        expect(execute.mock.calls[1][0]).toEqual(
            'UPDATE OR INSERT INTO SCHET (MONEYSCHET, NS, DATA, POKUPATCODE, SCODE) VALUES (?, ?, ?, ?, ?) MATCHING (SCODE)',
        );
        expect(execute.mock.calls[2]).toEqual([
            'EXECUTE PROCEDURE CREATESF9 (?, ?, ?, ?, ?)',
            [null, 1, 2, null, 0],
            false,
        ]);
        expect(execute.mock.calls[3]).toEqual([
            'UPDATE S SET PRIM = ?, STATUS = 1 WHERE PRIM = ?',
            ['120 закрыт', '120'],
            false,
        ]);
        expect(execute.mock.calls[8]).toEqual(['UPDATE S SET STATUS = ? WHERE SCODE IN (?,?)', [5, 1, 2], false]);
    });
    it('unPickupOzonFbo', async () => {
        query.mockResolvedValueOnce([{ PODBPOSCODE: '789', QUANSHOP: 5 }]);
        const res = await service.unPickupOzonFbo({ offer_id: '123', price: '456', quantity: 2 }, '12345');
        expect(res).toEqual(true);
        expect(query.mock.calls[0]).toEqual([
            'SELECT PODBPOSCODE, QUANSHOP FROM PODBPOS WHERE GOODSCODE = ? AND QUANSHOP >= ? AND SCODE IN (SELECT' +
                ' SCODE FROM S WHERE S.STATUS = 1 AND S.PRIM CONTAINING ?)',
            ['123', 2, '12345'],
        ]);
        expect(execute.mock.calls[0]).toEqual(['UPDATE PODBPOS SET QUANSHOP = ? WHERE PODBPOSCODE = ?', [3, '789']]);
        expect(commit.mock.calls).toHaveLength(1);
        expect(rollback.mock.calls).toHaveLength(0);
    });
    it('updatePrim', async () => {
        await service.updatePrim('1', '2');
        expect(execute.mock.calls[0]).toEqual(['UPDATE S SET PRIM = ?, STATUS = 1 WHERE PRIM = ?', ['2', '1'], true]);
    });
    it('getLastIncomingPrice', async () => {
        await service.getLastIncomingPrice('111', null);
        expect(query.mock.calls[0]).toEqual([
            'select first 1 * from trueprih where goodscode = ? and for_shop = ? order by data desc',
            ['111', 1],
            true,
        ]);
    });
    it('deltaGood', async () => {
        query.mockResolvedValueOnce([{ PRICE: 10.01 }]);
        await service.deltaGood('111', 10, 'TEST', null);
        expect(execute.mock.calls[0]).toEqual([
            'execute procedure deltaquanshopsklad4 ?, ?, ?, ?, ?, null, 1',
            ['111', 'Trade2006InvoiceService', -10, 'TEST', 10.01],
            true,
        ]);
    });
    it('getByDto', async () => {
        query.mockResolvedValueOnce([]);
        await service.getByDto({
            status: 1,
            buyerId: 2,
        });
        expect(query.mock.calls[0]).toEqual([
            'SELECT * FROM S WHERE 1=1 AND POKUPATCODE = ? AND STATUS = ?',
            [2, 1],
            true,
        ]);
    });
    it('getInvoiceLines', async () => {
        query.mockResolvedValueOnce([
            {
                GOODSCODE: 1,
                PRICE: 2,
                QUAN: 3,
            },
        ]);
        const res = await service.getInvoiceLines({ buyerId: 0, date: null, remark: '', status: 0, id: 1 });
        expect(res).toEqual([{ goodCode: 1, price: 2, quantity: 3 }]);
        expect(query.mock.calls[0]).toEqual(['SELECT * FROM REALPRICE WHERE SCODE = ?', [1], true]);
    });

    it('getPrimContaining', async () => {
        query.mockResolvedValueOnce([]);
        await service.getPrimContaining('test');
        expect(query.mock.calls[0]).toEqual(['SELECT * FROM S WHERE PRIM CONTAINING ?', ['test'], true]);
    })

    it('update', async () => {
        const dto: InvoiceUpdateDto = {
            IGK: '1234567890',
            START_PICKUP: '2020-01-01 00:01:00',
        };
        const invoice = new InvoiceDto();
        invoice.id = 123;
        const res = await service.update(invoice, dto);
        expect(res).toEqual(true);
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE S SET IGK = ?, START_PICKUP = ? WHERE SCODE = ?',
            ['1234567890', '2020-01-01 00:01:00', 123],
        ]);
    });

    describe('getSupplyPositions', () => {
        const mockProductable = {
            infoList: jest.fn(),
        };

        beforeEach(() => {
            query.mockClear();
            mockProductable.infoList.mockClear();
        });

        it('должен корректно получать позиции поставки', async () => {
            // Подготовка данных
            const supplyId = '123';
            const mockLines = [
                { GOODSCODE: 111, QUAN: 10, WHERE_ORDERED: '2' },
                { GOODSCODE: 222, QUAN: 5, WHERE_ORDERED: null }
            ];
            
            const mockProducts = [
                { sku: '111-2', barCode: 'BAR111', remark: 'Product 1' },
                { sku: '222', barCode: 'BAR222', remark: 'Product 2' }
            ];

            // Мокаем запрос к БД
            query.mockResolvedValueOnce(mockLines);
            
            // Мокаем ответ от productable
            mockProductable.infoList.mockResolvedValueOnce(mockProducts);

            // Выполняем тест
            const result = await service.getSupplyPositions(supplyId, mockProductable);

            // Проверяем результаты
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                supplyId,
                barCode: 'BAR111',
                remark: 'Product 1',
                quantity: 5 // 10 / 2 (whereOrdered)
            });
            expect(result[1]).toEqual({
                supplyId,
                barCode: 'BAR222',
                remark: 'Product 2',
                quantity: 5 // 5 / 1 (whereOrdered = null)
            });

            // Проверяем вызовы
            expect(query).toHaveBeenCalledWith('SELECT * FROM REALPRICE WHERE SCODE = ?', [123], true);
            expect(mockProductable.infoList).toHaveBeenCalledWith(['111-2', '222']);
        });

        it('должен выбрасывать ошибку, если продукт не найден', async () => {
            // Подготовка данных
            const supplyId = '123';
            const mockLines = [
                { GOODSCODE: 111, QUAN: 10, WHERE_ORDERED: '2' }
            ];
            
            const mockProducts = [
                { sku: 'wrong-sku', barCode: 'BAR111', remark: 'Product 1' }
            ];

            // Мокаем запрос к БД
            query.mockResolvedValueOnce(mockLines);
            
            // Мокаем ответ от productable
            mockProductable.infoList.mockResolvedValueOnce(mockProducts);

            // Проверяем, что метод выбрасывает ошибку
            await expect(service.getSupplyPositions(supplyId, mockProductable))
                .rejects
                .toThrow('Product not found for SKU: 111-2');
        });

        it('должен корректно обрабатывать пустой список позиций', async () => {
            // Подготовка данных
            const supplyId = '123';
            const mockLines = [];
            
            // Мокаем запрос к БД
            query.mockResolvedValueOnce(mockLines);
            
            // Мокаем пустой ответ от productable
            mockProductable.infoList.mockResolvedValueOnce([]);

            // Выполняем тест
            const result = await service.getSupplyPositions(supplyId, mockProductable);

            // Проверяем результаты
            expect(result).toHaveLength(0);
            expect(query).toHaveBeenCalledWith('SELECT * FROM REALPRICE WHERE SCODE = ?', [123], true);
            expect(mockProductable.infoList).toHaveBeenCalledWith([]);
        });
    });

    describe('distributePaymentByUPD', () => {
        beforeEach(() => {
            query.mockClear();
            execute.mockClear();
            commit.mockClear();
            rollback.mockClear();
        });

        it('должен успешно распределить платеж по УПД', async () => {
            // Подготовка данных
            const updNumber = 1;
            const updDate = '2024-01-01';
            const amount = 1000;

            const mockTransferOut = {
                SFCODE: 1,
                POKUPATCODE: 123,
                SCODE: 456,
                DATA: new Date(updDate),
                NSF: updNumber
            };

            const mockTransferOutLines = [
                { 
                    REALPRICEFCODE: 1, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD1', 
                    PRICE: 100, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: 10, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 500, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                },
                { 
                    REALPRICEFCODE: 2, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD2', 
                    PRICE: 60, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: 11, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 300, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                },
                { 
                    REALPRICEFCODE: 3, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD3', 
                    PRICE: 40, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: null, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 200, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                }
            ];

            // Мокаем получение УПД
            query.mockResolvedValueOnce([mockTransferOut]);
            
            // Мокаем получение строк УПД
            query.mockResolvedValueOnce(mockTransferOutLines);

            // Мокаем обновление сумм в строках
            execute.mockResolvedValue(undefined);

            // Выполняем тест
            const result = await service.distributePaymentByUPD(updNumber, updDate, amount);

            // Проверяем результат
            expect(result).toEqual({
                isSuccess: true,
                message: 'Платеж успешно распределен'
            });

            // Проверяем что методы были вызваны
            expect(query).toHaveBeenCalledTimes(2);
            expect(execute).toHaveBeenCalledTimes(6); // 3 строки УПД + 2 строки счета + 1 cash flow
            expect(commit).toHaveBeenCalled();
        });

        it('должен вернуть ошибку 404 если УПД не найден', async () => {
            // Подготовка данных
            const updNumber = 1;
            const updDate = '2024-01-01';
            const amount = 1000;

            // Мокаем пустой результат для УПД
            query.mockResolvedValueOnce([]);

            // Выполняем тест
            const result = await service.distributePaymentByUPD(updNumber, updDate, amount);

            // Проверяем результат
            expect(result).toEqual({
                isSuccess: false,
                message: '404: УПД не найден'
            });

            // При ошибках 404 транзакция не откатывается, так как ошибка обрабатывается в catch
            expect(rollback).not.toHaveBeenCalled();
        });

        it('должен вернуть ошибку 404 если строки УПД не найдены', async () => {
            // Подготовка данных
            const updNumber = 1;
            const updDate = '2024-01-01';
            const amount = 1000;

            const mockTransferOut = {
                SFCODE: 1,
                POKUPATCODE: 123,
                SCODE: 456,
                DATA: new Date(updDate),
                NSF: updNumber
            };

            // Мокаем получение УПД
            query.mockResolvedValueOnce([mockTransferOut]);
            
            // Мокаем пустой результат для строк УПД
            query.mockResolvedValueOnce([]);

            // Выполняем тест
            const result = await service.distributePaymentByUPD(updNumber, updDate, amount);

            // Проверяем результат
            expect(result).toEqual({
                isSuccess: false,
                message: '404: Строки УПД не найдены'
            });

            // При ошибках 404 транзакция не откатывается, так как ошибка обрабатывается в catch
            expect(rollback).not.toHaveBeenCalled();
        });

        it('должен вернуть ошибку при проблемах с БД', async () => {
            // Подготовка данных
            const updNumber = 1;
            const updDate = '2024-01-01';
            const amount = 1000;

            const mockTransferOut = {
                SFCODE: 1,
                POKUPATCODE: 123,
                SCODE: 456,
                DATA: new Date(updDate),
                NSF: updNumber
            };

            const mockTransferOutLines = [
                { 
                    REALPRICEFCODE: 1, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD1', 
                    PRICE: 100, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: 10, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 500, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                }
            ];

            // Мокаем успешные запросы
            query.mockResolvedValueOnce([mockTransferOut]);
            query.mockResolvedValueOnce(mockTransferOutLines);
            
            // Мокаем ошибку БД в execute
            execute.mockRejectedValueOnce(new Error('Database connection failed'));

            // Выполняем тест
            const result = await service.distributePaymentByUPD(updNumber, updDate, amount);

            // Проверяем результат
            expect(result).toEqual({
                isSuccess: false,
                message: 'Ошибка при распределении платежа: Database connection failed'
            });

            // Ошибка обрабатывается в catch блоке, rollback не вызывается
            expect(rollback).not.toHaveBeenCalled();
        });

        it('должен корректно распределять суммы пропорционально', async () => {
            // Подготовка данных
            const updNumber = 1;
            const updDate = '2024-01-01';
            const amount = 1000;

            const mockTransferOut = {
                SFCODE: 1,
                POKUPATCODE: 123,
                SCODE: 456,
                DATA: new Date(updDate),
                NSF: updNumber
            };

            // Мокаем данные из БД с правильными полями
            const mockTransferOutLines = [
                { 
                    REALPRICEFCODE: 1, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD1', 
                    PRICE: 100, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: 10, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 500, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                },
                { 
                    REALPRICEFCODE: 2, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD2', 
                    PRICE: 60, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: 11, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 300, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                },
                { 
                    REALPRICEFCODE: 3, 
                    SFCODE: 1, 
                    GOODSCODE: 'GOOD3', 
                    PRICE: 40, 
                    QUAN: 5, 
                    OPRIH: 1, 
                    REALPRICECODE: null, 
                    DIRECTSKLADNEED: 0, 
                    DIRECTSHOPNEED: 0, 
                    DIRECTSHOP: 0, 
                    DIRECTSKLAD: 0, 
                    GTD: '', 
                    STRANA: '', 
                    SUMMAP: 200, 
                    SECONDINSERT: 0, 
                    MARK1C: 0, 
                    USERNAME: '', 
                    SHOP_SALED_NAKL_D_ID: 0, 
                    INSERT_ATTR: '', 
                    MODIFY_ATTR: ''
                }
            ];

            // Мокаем запросы
            query.mockResolvedValueOnce([mockTransferOut]);
            query.mockResolvedValueOnce(mockTransferOutLines);
            execute.mockResolvedValue(undefined);

            // Выполняем тест
            const result = await service.distributePaymentByUPD(updNumber, updDate, amount);

            // Проверяем результат
            expect(result.isSuccess).toBe(true);

            // Проверяем, что суммы были обновлены пропорционально
            // 500/1000 * 1000 = 500, 300/1000 * 1000 = 300, 200/1000 * 1000 = 200
            expect(execute).toHaveBeenCalledWith(
                'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
                [500, 1]
            );
            expect(execute).toHaveBeenCalledWith(
                'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
                [300, 2]
            );
            expect(execute).toHaveBeenCalledWith(
                'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
                [200, 3]
            );
        });
    });
});
