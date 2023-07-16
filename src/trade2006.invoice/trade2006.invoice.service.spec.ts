import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006InvoiceService } from './trade2006.invoice.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { ConfigService } from '@nestjs/config';

describe('Trade2006InvoiceService', () => {
    let service: Trade2006InvoiceService;
    const query = jest.fn();
    const execute = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const get = jest.fn().mockReturnValueOnce(1).mockReturnValueOnce(2);
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006InvoiceService,
                {
                    provide: FIREBIRD,
                    useValue: {
                        query: async (query: string, remark: string[]) =>
                            remark[0] === 'test1'
                                ? [
                                      {
                                          PRIM: 'test1',
                                          POKUPATCODE: 1,
                                          SCODE: 2,
                                          DATA: '2020-01-01',
                                          STATUS: 0,
                                      },
                                  ]
                                : [],
                        execute,
                        transaction: async () => ({
                            query,
                            execute,
                            commit,
                            rollback,
                        }),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: { get },
                },
            ],
        }).compile();

        execute.mockClear();
        query.mockClear();
        service = module.get<Trade2006InvoiceService>(Trade2006InvoiceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test create', async () => {
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
            'SELECT MAX(NS) FROM S WHERE FIRM_ID = ? AND DATA > ?',
            [1, '2023-01-01'],
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
    it('test isExists', async () => {
        let res = await service.isExists('test1');
        expect(res).toBeTruthy();
        res = await service.isExists('test2');
        expect(res).toBeFalsy();
    });
    it('test getByPosting', async () => {
        const res = await service.getByPosting({
            posting_number: 'test1',
            status: 'string',
            in_process_at: 'string',
            products: [],
        });
        expect(res).toEqual({
            id: 2,
            buyerId: 1,
            date: new Date('2020-01-01'),
            remark: 'test1',
            status: 0,
        });
    });
    it('Test pickupInvoice', async () => {
        await service.pickupInvoice({ id: 1, date: new Date(), remark: '1', buyerId: 1, status: 3 });
        expect(execute.mock.calls[0]).toEqual(['UPDATE PODBPOS SET QUANSHOP = QUANSHOPNEED WHERE SCODE = ?', [1]]);
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
        expect(execute.mock.calls[0]).toEqual(['UPDATE S SET STATUS = ? WHERE SCODE IN (?)', [3, 1], true]);
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
        expect(query.mock.calls[0]).toEqual(['SELECT * FROM REALPRICE WHERE SCODE = ?', [1], true]);
        expect(execute.mock.calls[0]).toEqual([
            'UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?',
            [111.11, undefined],
            true,
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
        query.mockReturnValue([{ SCODE: 2, PRIM: '2-2' }]);
        await service.updateByTransactions([{ posting_number: '2-2', amount: 111.11 }]);
        expect(query.mock.calls).toHaveLength(2);
        expect(query.mock.calls[0]).toEqual([
            'SELECT *\n                 FROM S\n                 WHERE PRIM IN' + ' (?)',
            ['2-2'],
            false,
        ]);
        expect(query.mock.calls[1]).toEqual(['SELECT * FROM REALPRICE WHERE SCODE = ?', [2], false]);
        expect(execute.mock.calls).toHaveLength(4);
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
            invoiceLines: [{ goodCode: '444', price: '1.11', quantity: 2 }],
            remark: '321',
            status: 3,
        });
    });
});
