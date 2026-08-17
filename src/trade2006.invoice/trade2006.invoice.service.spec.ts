import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006InvoiceService } from './trade2006.invoice.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { Cache } from '@nestjs/cache-manager';
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";
import { InvoiceDto } from "../invoice/dto/invoice.dto";
import { GoodServiceEnum } from "../good/good.service.enum";

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
        commit.mockResolvedValue(undefined); // own-транзакция getGtdByKi делает await t.commit().catch()
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
            .mockResolvedValueOnce([{ REALPRICECODE: 10 }])
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
        // строки счёта возвращаются с realpricecode (S12: маппинг для миграции КМ)
        expect(res.invoiceLines[0].realpricecode).toBe(10);
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
    describe('findByPosting — предикат вместо булева isExists (итерация 3)', () => {
        it('точное равенство ИЛИ префикс с пробелом, чужие номера не цепляются', async () => {
            query.mockResolvedValueOnce([]);
            await service.findByPosting('0126-0026-1');
            expect(query.mock.calls[0]).toEqual([
                'SELECT * FROM S WHERE PRIM = ? OR PRIM STARTING WITH ?',
                ['0126-0026-1', '0126-0026-1 '],
                true,
            ]);
        });

        it('числовой posting_number приводится к строке (Яндекс, дубли 14.08.2026)', async () => {
            query.mockResolvedValueOnce([{ SCODE: 1, NS: 70441, PRIM: '60327314179', STATUS: 3 }]);
            const match = await service.findByPosting({ posting_number: 60327314179 } as any);
            expect(query.mock.calls[0][1]).toEqual(['60327314179', '60327314179 ']);
            expect(match).not.toBeNull();
            expect(match.mark).toBe('');
        });

        it('счёта нет → null', async () => {
            query.mockResolvedValueOnce([]);
            expect(await service.findByPosting('нет-такого')).toBeNull();
        });

        it('чистый счёт → пометки нет', async () => {
            query.mockResolvedValueOnce([{ PRIM: 'test1', SCODE: 2, POKUPATCODE: 1, STATUS: 3 }]);
            const res = await service.findByPosting('test1');
            expect(res).toMatchObject({ mark: '', cancelled: false, closed: false });
            expect(res.invoice.id).toBe(2);
        });

        it('переименованный отменой → cancelled, пометка отдаётся вызывающему', async () => {
            query.mockResolvedValueOnce([{ PRIM: 'test1 отмена FBO', SCODE: 2, POKUPATCODE: 1, STATUS: 1 }]);
            const res = await service.findByPosting('test1');
            expect(res).toMatchObject({ mark: ' отмена FBO', cancelled: true, closed: false });
        });

        it('закрытый счёт → closed', async () => {
            query.mockResolvedValueOnce([{ PRIM: 'test1 закрыт', SCODE: 2, POKUPATCODE: 1, STATUS: 5 }]);
            const res = await service.findByPosting('test1');
            expect(res).toMatchObject({ cancelled: false, closed: true });
        });

        it('две строки на номер → берётся точное совпадение, а не первое попавшееся', async () => {
            query.mockResolvedValueOnce([
                { PRIM: 'test1 отмена', SCODE: 9, POKUPATCODE: 1, STATUS: 1 },
                { PRIM: 'test1', SCODE: 2, POKUPATCODE: 1, STATUS: 3 },
            ]);
            const res = await service.findByPosting('test1');
            expect(res.invoice.id).toBe(2);
            expect(res.cancelled).toBe(false);
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
    describe('FBO mark migration helpers', () => {
        it('getStorageSS — SHOPSKLAD → 1', () => {
            expect(service.getStorageSS()).toBe(1);
        });

        it('findRealpriceCodes — все RPC по SCODE в порядке вставки', async () => {
            query.mockResolvedValueOnce([
                { REALPRICECODE: 301 },
                { REALPRICECODE: 302 },
                { REALPRICECODE: 303 },
            ]);
            const res = await service.findRealpriceCodes(100, null);
            expect(res).toEqual([301, 302, 303]);
            expect(query.mock.calls[0][0]).toBe('SELECT REALPRICECODE FROM REALPRICE WHERE SCODE = ? ORDER BY REALPRICECODE');
            expect(query.mock.calls[0][1]).toEqual([100]);
        });

        it('findFboPodbposCandidates — уровень склада из SQL (LVL), внутри уровня ярусы по кодам', async () => {
            // LVL считается в SQL (CONTAINING регистронезависим), ярусы — по счётчикам кодов
            query.mockResolvedValueOnce([
                { PODBPOSCODE: 3003, SCODE: 300, REALPRICECODE: 300, QUANAVAIL: 1, PRIM: '777-1 отмена FBO', LVL: 2, CNT_NOM: 0, CNT_LIVE: 0, CNT_TT3: 0 },
                { PODBPOSCODE: 1001, SCODE: 100, REALPRICECODE: 100, QUANAVAIL: 1, PRIM: 'ПУШКИНО_1_РФЦ 555', LVL: 0, CNT_NOM: 0, CNT_LIVE: 0, CNT_TT3: 0 },
                { PODBPOSCODE: 2002, SCODE: 200, REALPRICECODE: 200, QUANAVAIL: 1, PRIM: 'Москва, МО и Дальние регионы 666', LVL: 1, CNT_NOM: 0, CNT_LIVE: 0, CNT_TT3: 0 },
            ]);
            const res = await service.findFboPodbposCandidates(
                '444',
                ['ПУШКИНО_1_РФЦ', 'Москва, МО и Дальние регионы', 'отмена FBO'],
                1,
                null,
            );
            expect(res.map((c) => c.podbposcode)).toEqual([1001, 2002, 3003]);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('s.PRIM CONTAINING ? OR s.PRIM CONTAINING ? OR s.PRIM CONTAINING ?');
            expect(sql).toContain('CASE WHEN s.PRIM CONTAINING ? THEN 0');
            expect(sql).toContain('rp.REALPRICECODE = pp.REALPRICECODE');
            expect(sql).toContain('pp.SKLAD_ID IS NULL');
            expect(sql).toContain('QUANSHOP');
            // Счётчик выведенных кодов на строке — сигнал «возврат проданного» для письма миграции.
            expect(sql).toContain('m.TRANSFER_TYPE = 3 AND m.STATUS = 6) AS CNT_DEAD');
            // параметры: nominal (CNT_NOM), nominal (CNT_TT3), prims для LVL, goodscode, prims для WHERE
            expect(query.mock.calls[0][1]).toEqual([
                1, 1,
                'ПУШКИНО_1_РФЦ', 'Москва, МО и Дальние регионы', 'отмена FBO',
                '444',
                'ПУШКИНО_1_РФЦ', 'Москва, МО и Дальние регионы', 'отмена FBO',
            ]);
        });

        it('findFboPodbposCandidates — ярусы: коды номинала → без кодов → чужой номинал; TT=3 вперёд', async () => {
            query.mockResolvedValueOnce([
                { PODBPOSCODE: 1, SCODE: 10, REALPRICECODE: 10, QUANAVAIL: 5, PRIM: 'W', LVL: 0, CNT_NOM: 0, CNT_LIVE: 2, CNT_TT3: 0 }, // ярус (в): чужой номинал
                { PODBPOSCODE: 2, SCODE: 20, REALPRICECODE: 20, QUANAVAIL: 5, PRIM: 'W', LVL: 0, CNT_NOM: 1, CNT_LIVE: 1, CNT_TT3: 0 }, // ярус (а)
                { PODBPOSCODE: 3, SCODE: 30, REALPRICECODE: 30, QUANAVAIL: 5, PRIM: 'W', LVL: 0, CNT_NOM: 0, CNT_LIVE: 0, CNT_TT3: 0 }, // ярус (б): без кодов
                { PODBPOSCODE: 4, SCODE: 40, REALPRICECODE: 40, QUANAVAIL: 5, PRIM: 'W', LVL: 0, CNT_NOM: 2, CNT_LIVE: 2, CNT_TT3: 1 }, // ярус (а) + TT=3
            ]);
            const res = await service.findFboPodbposCandidates('444', ['W'], 5, null);
            expect(res.map((c) => c.podbposcode)).toEqual([4, 2, 3, 1]);
        });

        it('findFboPodbposCandidates — пустой prims даёт []', async () => {
            const res = await service.findFboPodbposCandidates('444', [], 1, null);
            expect(res).toEqual([]);
            expect(query).not.toHaveBeenCalled();
        });

        it('findLiveMigratableCodes — живые коды номинала, TT=3 вперёд', async () => {
            query.mockResolvedValueOnce([{ KI: 'KI-3' }, { KI: 'KI-1' }]);
            const res = await service.findLiveMigratableCodes(100, 5, null);
            expect(res).toEqual([{ ki: 'KI-3' }, { ki: 'KI-1' }]);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('m.REALPRICEFCODE IS NULL');
            expect(sql).toContain('(m.TRANSFER_TYPE = 2 OR (m.TRANSFER_TYPE = 3 AND m.STATUS = 5))');
            expect(sql).toContain('COALESCE(m.QUANTITY, 1) = ?');
            expect(sql).toContain('ORDER BY m.TRANSFER_TYPE DESC');
            expect(query.mock.calls[0][1]).toEqual([100, 5]);
        });

        it('migrateMarkCode — EXECUTE PROCEDURE MARKCODE_MIGRATE', async () => {
            const t = { execute: jest.fn(), commit: jest.fn() };
            await service.migrateMarkCode('KI-1', 100, 900, '444', 1, t as any);
            expect(t.execute).toHaveBeenCalledWith(
                'EXECUTE PROCEDURE MARKCODE_MIGRATE (?, ?, ?, ?, ?)',
                ['KI-1', 100, 900, '444', 1],
            );
            expect(t.commit).not.toHaveBeenCalled();
        });

        it('migratePodbpos — EXECUTE PROCEDURE PODBPOS_MIGRATE_QTY (s_s из конфига)', async () => {
            const t = { execute: jest.fn(), commit: jest.fn() };
            await service.migratePodbpos(1001, 999, 900, '444', 10, t as any);
            expect(t.execute).toHaveBeenCalledWith(
                'EXECUTE PROCEDURE PODBPOS_MIGRATE_QTY (?, ?, ?, ?, ?, ?)',
                [1001, 999, 900, '444', 10, 1],
            );
            expect(t.commit).not.toHaveBeenCalled();
        });

        it('clearInvoiceReserve — DELETE RESERVEDPOS + зануление need + удаление пустых строк', async () => {
            const t = { execute: jest.fn(), commit: jest.fn() };
            await service.clearInvoiceReserve(999, t as any);
            expect(t.execute.mock.calls[0][0]).toContain('DELETE FROM RESERVEDPOS');
            expect(t.execute.mock.calls[1][0]).toContain('QUANSKLADNEED = 0, QUANSHOPNEED = 0, QUANNEED = 0');
            expect(t.execute.mock.calls[2][0]).toContain('DELETE FROM PODBPOS');
            expect(t.execute.mock.calls.map((c) => c[1])).toEqual([[999], [999], [999]]);
            expect(t.commit).not.toHaveBeenCalled();
        });

        it('decrementPodbpos — UPDATE QUANSHOP -= take', async () => {
            await service.decrementPodbpos(1001, 2, null);
            expect(execute.mock.calls[0]).toEqual([
                'UPDATE PODBPOS SET QUANSHOP = QUANSHOP - ? WHERE PODBPOSCODE = ?',
                [2, 1001],
                true,
            ]);
        });

    });

    describe('isPickedUp — подобран = STATUS 4', () => {
        it('STATUS 4 → true (подобран)', async () => {
            expect(await service.isPickedUp({ status: 4 } as any)).toBe(true);
        });
        it('STATUS 3 → false (в подборке)', async () => {
            expect(await service.isPickedUp({ status: 3 } as any)).toBe(false);
        });
        it('STATUS 5 → false (другой статус, не подобран)', async () => {
            expect(await service.isPickedUp({ status: 5 } as any)).toBe(false);
        });
    });

    describe('FBS mark scan helpers', () => {
        it('attachMarkCodeForFbs — EXECUTE PROCEDURE MARKCODE_ATTACH_FOR_FBS с km_full', async () => {
            const t = { execute: jest.fn(), commit: jest.fn() };
            await service.attachMarkCodeForFbs('KI-1', 500, '444', 0, 'RAW-SCAN-FULL', t as any);
            expect(t.execute).toHaveBeenCalledWith(
                'EXECUTE PROCEDURE MARKCODE_ATTACH_FOR_FBS (?, ?, ?, ?, ?)',
                ['KI-1', 500, '444', 0, 'RAW-SCAN-FULL'],
            );
            expect(t.commit).not.toHaveBeenCalled();
        });

        it('detachMarkCodeForFbs — EXECUTE PROCEDURE MARKCODE_DETACH_FOR_FBS', async () => {
            const t = { execute: jest.fn(), commit: jest.fn() };
            await service.detachMarkCodeForFbs('KI-1', 500, 0, t as any);
            expect(t.execute).toHaveBeenCalledWith(
                'EXECUTE PROCEDURE MARKCODE_DETACH_FOR_FBS (?, ?, ?)',
                ['KI-1', 500, 0],
            );
            expect(t.commit).not.toHaveBeenCalled();
        });

        it('countFreeMarkCodesForGood — возвращает FREE_COUNT', async () => {
            query.mockResolvedValueOnce([{ FREE_COUNT: 5 }]);
            const res = await service.countFreeMarkCodesForGood('444', null);
            expect(res).toBe(5);
            expect(query.mock.calls[0]).toEqual([
                'SELECT FREE_COUNT FROM COUNT_FREE_MARKCODES_FOR_GOOD (?)',
                ['444'],
                true,
            ]);
        });

        it('countFreeMarkCodesForGood — пустой результат → 0', async () => {
            query.mockResolvedValueOnce([]);
            expect(await service.countFreeMarkCodesForGood('444', null)).toBe(0);
        });

        it('getMarkCodeInfoByKi — найден, QUANTITY из базы', async () => {
            query.mockResolvedValueOnce([{ GOODSCODE: 444, QUANTITY: 50 }]);
            expect(await service.getMarkCodeInfoByKi('KI-1', null)).toEqual({
                goodscode: '444',
                quantity: 50,
            });
            expect(query.mock.calls[0]).toEqual([
                'SELECT GOODSCODE, COALESCE(QUANTITY, 1) AS QUANTITY FROM MARKCODES WHERE KI = ?',
                ['KI-1'],
                true,
            ]);
        });

        it('getMarkCodeInfoByKi — не найден → null', async () => {
            query.mockResolvedValueOnce([]);
            expect(await service.getMarkCodeInfoByKi('KI-X', null)).toBeNull();
        });

        it('getKmFullByKi — возвращает полный rawScan', async () => {
            query.mockResolvedValueOnce([{ KM_FULL: '01001234...91...92...' }]);
            expect(await service.getKmFullByKi('KI-1', null)).toBe('01001234...91...92...');
            expect(query.mock.calls[0]).toEqual([
                'SELECT KM_FULL FROM MARKCODES WHERE KI = ?',
                ['KI-1'],
                true,
            ]);
        });

        it('getKmFullByKi — KM_FULL=NULL или нет строки → null', async () => {
            query.mockResolvedValueOnce([{ KM_FULL: null }]);
            expect(await service.getKmFullByKi('KI-1', null)).toBeNull();
            query.mockResolvedValueOnce([]);
            expect(await service.getKmFullByKi('KI-X', null)).toBeNull();
        });

        it('getGtdByKi — склад: обрезает хвост ГТД до 3 частей', async () => {
            query.mockResolvedValueOnce([{ SKLADINCODE: 285013, SHOPINCODE: null }]);
            query.mockResolvedValueOnce([{ GTD: '10228010/260326/5094327/2' }]);
            expect(await service.getGtdByKi('KI-1', null)).toBe('10228010/260326/5094327');
        });

        it('getGtdByKi — магазин: цепочка SHOPIN→SHOPINPR (не SHOPIN.GTD)', async () => {
            query.mockResolvedValueOnce([{ SKLADINCODE: null, SHOPINCODE: 777 }]);
            query.mockResolvedValueOnce([{ GTD: '10005030/260623/3170340/1' }]);
            expect(await service.getGtdByKi('KI-2', null)).toBe('10005030/260623/3170340');
            expect(query.mock.calls[1][0]).toContain('JOIN SHOPINPR sp ON sp.SHOPINPRCODE = si.SHOPINPRCODE');
            expect(query.mock.calls[1][1]).toEqual([777]);
        });

        it('getGtdByKi — нет прихода/пусто → null', async () => {
            query.mockResolvedValueOnce([{ SKLADINCODE: null, SHOPINCODE: null }]);
            expect(await service.getGtdByKi('KI-3', null)).toBeNull();
        });

        it('getPickedPartiesGtdByScode — партии из FIFO_T + обрезка ГТД, магазинный источник', async () => {
            query.mockResolvedValueOnce([
                { REALPRICECODE: 601391, GOODSCODE: 376743, PARTY_QUAN: 1, GTD: '10005030/260623/3170340/1' },
                { REALPRICECODE: 601392, GOODSCODE: 376743, PARTY_QUAN: 10, GTD: null },
            ]);
            const res = await service.getPickedPartiesGtdByScode(91786, null);
            expect(res).toEqual([
                { realpricecode: 601391, goodscode: '376743', quantity: 1, gtd: '10005030/260623/3170340' },
                { realpricecode: 601392, goodscode: '376743', quantity: 10, gtd: null },
            ]);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('FROM PODBPOS pp');
            expect(sql).toContain('JOIN FIFO_T f ON f.PR_META_OUT_ID = pout.ID');
            expect(sql).toContain('JOIN SHOPINPR sp'); // STORAGE_TYPE=SHOPSKLAD → магазинная ветка
            expect(query.mock.calls[0][1]).toEqual([91786]);
        });

        it('listFbsAwaitingShip — JOIN MARKCODES TT=3 + FINISH_PICKUP + IGK + buyerId', async () => {
            query.mockResolvedValueOnce([
                {
                    SCODE: 85241,
                    NS: 8344,
                    STATUS: 3,
                    POKUPATCODE: 24231,
                    DATA: new Date('2026-05-11'),
                    PRIM: 'TEST-FULL',
                    IGK: 'BARCODE',
                    START_PICKUP: null,
                    FINISH_PICKUP: new Date('2026-05-11'),
                },
            ]);
            const res = await service.listFbsAwaitingShip(24231, null);
            expect(res).toHaveLength(1);
            expect(res[0]).toMatchObject({
                id: 85241,
                number: 8344,
                remark: 'TEST-FULL',
                buyerId: 24231,
                barcode: 'BARCODE',
            });
            const [sql, params, autoCommit] = query.mock.calls[0];
            expect(sql).toContain('JOIN REALPRICE');
            expect(sql).toContain('JOIN MARKCODES');
            expect(sql).toContain('m.TRANSFER_TYPE = 3');
            expect(sql).toContain('s.FINISH_PICKUP IS NOT NULL');
            expect(sql).toContain('s.IGK IS NOT NULL');
            expect(sql).toContain('s.POKUPATCODE = ?');
            expect(sql).toContain('s.DATA >= ?');
            expect(params).toHaveLength(2);
            expect(params[0]).toBe(24231);
            expect(params[1]).toBeInstanceOf(Date);
            // дата = сегодня - 2 дня, 00:00:00
            const expected = new Date();
            expected.setDate(expected.getDate() - 2);
            expected.setHours(0, 0, 0, 0);
            expect((params[1] as Date).getTime()).toBe(expected.getTime());
            expect(autoCommit).toBe(true);
        });

        it('getAttachedMarkCodesByScode — JOIN с REALPRICE, фильтр TT=3, QUANTITY в штуках', async () => {
            get.mockImplementation((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? true : def));
            query.mockResolvedValueOnce([
                { KI: 'A', GOODSCODE: 444, REALPRICECODE: 100, QUANTITY: 1 },
                { KI: 'B', GOODSCODE: 444, REALPRICECODE: 100, QUANTITY: 50 },
            ]);
            const res = await service.getAttachedMarkCodesByScode(50, null);
            expect(res).toEqual([
                { ki: 'A', goodscode: '444', realpricecode: 100, quantity: 1 },
                { ki: 'B', goodscode: '444', realpricecode: 100, quantity: 50 },
            ]);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('JOIN REALPRICE');
            expect(sql).toContain('m.TRANSFER_TYPE = 3');
            expect(sql).toContain('COALESCE(m.QUANTITY, 1)');
            expect(query.mock.calls[0][1]).toEqual([50]);
        });

        it('getAttachedMarkCodesByScode — MARK_CODES_ENABLED=false → [] без запроса (магазин, нет MARKCODES)', async () => {
            get.mockImplementation((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? false : def));
            const res = await service.getAttachedMarkCodesByScode(50, null);
            expect(res).toEqual([]);
            expect(query).not.toHaveBeenCalled();
        });

        it('getMarkCodesStateByScode — без фильтра по TT: слою 2 нужны и TT=2, и RETIRE_REASON', async () => {
            get.mockImplementation((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? true : def));
            query.mockResolvedValueOnce([
                { KI: 'A', STATUS: 5, TRANSFER_TYPE: 3, RETIRE_REASON: null, KM_FULL: 'KM-A' },
                { KI: 'B', STATUS: 6, TRANSFER_TYPE: 2, RETIRE_REASON: 3, KM_FULL: null },
            ]);
            const res = await service.getMarkCodesStateByScode(50, null);
            expect(res).toEqual([
                { ki: 'A', status: 5, transferType: 3, retireReason: null, kmFull: 'KM-A', price: null },
                { ki: 'B', status: 6, transferType: 2, retireReason: 3, kmFull: null, price: null },
            ]);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('JOIN REALPRICE');
            expect(sql).not.toContain('TRANSFER_TYPE =');
            expect(query.mock.calls[0][1]).toEqual([50]);
        });

        it('getMarkCodesStateByScode — MARK_CODES_ENABLED=false → [] без запроса', async () => {
            get.mockImplementation((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? false : def));
            expect(await service.getMarkCodesStateByScode(50, null)).toEqual([]);
            expect(query).not.toHaveBeenCalled();
        });

        it('findStuckMarkCodes — TT=2/3 в обороте на счёте вне работы, счета в подборке исключены', async () => {
            get.mockImplementation((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? true : def));
            query.mockResolvedValueOnce([
                {
                    KI: 'A',
                    GOODSCODE: 444,
                    STATUS: 5,
                    TRANSFER_TYPE: 3,
                    SCODE: 91933,
                    NS: 5577,
                    PRIM: '33261943-0361-1 закрыт',
                    S_STATUS: 5,
                    DATA: new Date('2026-08-01'),
                },
            ]);
            const res = await service.findStuckMarkCodes(3, null);
            expect(res).toEqual([
                {
                    ki: 'A',
                    goodscode: '444',
                    status: 5,
                    transferType: 3,
                    scode: 91933,
                    invoiceNumber: 5577,
                    prim: '33261943-0361-1 закрыт',
                    invoiceStatus: 5,
                    invoiceDate: new Date('2026-08-01'),
                },
            ]);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('m.TRANSFER_TYPE IN (2, 3)');
            expect(sql).toContain('m.REALPRICEFCODE IS NULL');
            // Счета «в сборке» исключены, но собранный дольше 30 дней — уже висяк.
            expect(sql).toContain('m.STATUS = 5 AND (s.SCODE IS NULL OR s.STATUS NOT IN (3, 4) OR (s.STATUS = 4 AND s.DATA < ?))');
            // Зеркальный висяк: выведенный нашей продажей код на счёте-доноре.
            expect(sql).toContain('m.STATUS = 6 AND m.RETIRE_REASON = 1 AND s.PRIM CONTAINING ?');
            expect(query.mock.calls[0][1][0]).toBeInstanceOf(Date);
            expect(query.mock.calls[0][1][1]).toBe('отмена');
            expect(query.mock.calls[0][1][2]).toBeInstanceOf(Date);
        });

        it('findStuckMarkCodes — MARK_CODES_ENABLED=false → [] без запроса', async () => {
            get.mockImplementation((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? false : def));
            expect(await service.findStuckMarkCodes(3, null)).toEqual([]);
            expect(query).not.toHaveBeenCalled();
        });

        it('getRealpriceLinesByScode — все строки счёта', async () => {
            query.mockResolvedValueOnce([
                { REALPRICECODE: 100, GOODSCODE: 444, QUAN: 2 },
                { REALPRICECODE: 101, GOODSCODE: 555, QUAN: 1 },
            ]);
            const res = await service.getRealpriceLinesByScode(50, null);
            expect(res).toEqual([
                { realpricecode: 100, goodscode: '444', quantity: 2 },
                { realpricecode: 101, goodscode: '555', quantity: 1 },
            ]);
            expect(query.mock.calls[0]).toEqual([
                'SELECT REALPRICECODE, GOODSCODE, QUAN FROM REALPRICE WHERE SCODE = ?',
                [50],
                true,
            ]);
        });
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

    describe('FBO журнал недостач и цепочки', () => {
        const t = { query, execute } as any;

        it('logShortage → UPDATE OR INSERT в FBO_SHORTAGE', async () => {
            await service.logShortage(GoodServiceEnum.OZON, '321', '444', 2, 'CLUSTER', t);
            expect(execute.mock.calls[0][0]).toContain('UPDATE OR INSERT INTO FBO_SHORTAGE');
            expect(execute.mock.calls[0][1]).toEqual(['ozon', '321', '444', 2, 'CLUSTER']);
            expect(execute.mock.calls[0][2]).toBe(false);
        });

        it('logMigrationLink → INSERT в FBO_MIGRATION_LINK', async () => {
            await service.logMigrationLink(
                { posting: '321', goodscode: '444', quantity: 2, donorScode: 10, donorRpc: 100, targetScode: 999, targetRpc: 300 },
                t,
            );
            expect(execute.mock.calls[0][0]).toContain('INSERT INTO FBO_MIGRATION_LINK');
            expect(execute.mock.calls[0][1]).toEqual(['321', '444', 2, 10, 100, 999, 300]);
        });

        it('findFboPodbposDonor → маппит строку донора', async () => {
            query.mockResolvedValueOnce([{ PODBPOSCODE: 1, SCODE: 10, REALPRICECODE: 100, QUANAVAIL: 5 }]);
            const donor = await service.findFboPodbposDonor('444', ['W'], 2, t);
            expect(donor).toEqual({ podbposcode: 1, scode: 10, realpricecode: 100, quanAvail: 5 });
            expect(query.mock.calls[0][1]).toEqual(['W', '444', 2, 'W']);
        });

        it('findFboPodbposDonor → null при пустом результате', async () => {
            query.mockResolvedValueOnce([]);
            expect(await service.findFboPodbposDonor('444', ['W'], 2, t)).toBeNull();
        });

        it('findFboPodbposDonor → null при пустом prims (без запроса)', async () => {
            expect(await service.findFboPodbposDonor('444', [], 2, t)).toBeNull();
            expect(query).not.toHaveBeenCalled();
        });

        it('pickupFboUnlessShortage: счёт в недоборе → НЕ подбираем (без UPDATE)', async () => {
            query.mockResolvedValueOnce([{ X: 1 }]); // isInFboShortage → true
            await service.pickupFboUnlessShortage({ id: 1, remark: 'p1', status: 3 } as any, t);
            expect(execute).not.toHaveBeenCalled();
        });

        it('pickupFboUnlessShortage: не в недоборе → подбираем (UPDATE PODBPOS)', async () => {
            query.mockResolvedValueOnce([]); // isInFboShortage → false
            await service.pickupFboUnlessShortage({ id: 1, remark: 'p1', status: 3 } as any, t);
            expect(execute).toHaveBeenCalledWith(
                'UPDATE PODBPOS SET QUANSHOP= QUANSHOPNEED WHERE SCODE = ?',
                [1],
                false,
            );
        });
    });
});
