import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006InvoiceService } from './trade2006.invoice.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { ConfigService } from '@nestjs/config';

describe('Trade2006InvoiceService', () => {
    let service: Trade2006InvoiceService;
    const query = jest
        .fn()
        .mockResolvedValueOnce([{ MAX: 1 }])
        .mockResolvedValueOnce([{ GEN_ID: 2 }])
        .mockRejectedValueOnce({ message: 'Test error' });
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
                        query: async (query: string, remark: string[]) => (remark[0] === 'test1' ? [1] : []),
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

        service = module.get<Trade2006InvoiceService>(Trade2006InvoiceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test create', async () => {
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
});
