import { Test, TestingModule } from '@nestjs/testing';
import { FetchTransactionsCommand } from './fetch-transactions.command';
import { WbOrderService } from '../wb.order.service';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { WbTransactionDto } from '../dto/wb.transaction.dto';

describe('FetchTransactionsCommand', () => {
    let command: FetchTransactionsCommand;
    const getTransactions = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FetchTransactionsCommand,
                {
                    provide: WbOrderService,
                    useValue: { getTransactions },
                },
            ],
        }).compile();

        getTransactions.mockClear();
        command = module.get<FetchTransactionsCommand>(FetchTransactionsCommand);
    });

    it('should be defined', () => {
        expect(command).toBeDefined();
    });

    it('should filter by sticker_id if no srid', async () => {
        const dateFrom = new Date('2025-09-21');
        const context: IWbTransactionProcessingContext = {
            dateFrom,
            stickerId: '42197484529',
        };

        const mockTransactions = [
            {
                order_dt: '2025-09-21',
                srid: 'SRID123',
                sticker_id: '42197484529',
                delivery_rub: 10,
                ppvz_for_pay: 100,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 1,
                assembly_id: 5001,
            },
            {
                order_dt: '2025-09-22',
                srid: 'SRID456',
                sticker_id: '11111111111',
                delivery_rub: 20,
                ppvz_for_pay: 200,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 2,
                assembly_id: null,
            },
        ];

        getTransactions.mockResolvedValueOnce(mockTransactions);

        const result = await command.execute(context);

        expect(getTransactions).toHaveBeenCalledWith({
            from: dateFrom,
            to: expect.any(Date),
        });
        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].sticker_id).toBe('42197484529');
    });

    it('should fetch and filter transactions by srid', async () => {
        const dateFrom = new Date('2025-09-21');
        const dateTo = new Date('2025-10-12');
        const context: IWbTransactionProcessingContext = {
            dateFrom,
            dateTo,
            stickerId: '42197484529',
            srid: 'SRID123',
        };

        const mockTransactions: WbTransactionDto[] = [
            {
                order_dt: '2025-09-21',
                srid: 'SRID123',
                delivery_rub: 10,
                ppvz_for_pay: 100,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 1,
                assembly_id: 5001,
            },
            {
                order_dt: '2025-09-22',
                srid: 'SRID456',
                delivery_rub: 20,
                ppvz_for_pay: 200,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 2,
                assembly_id: null,
            },
            {
                order_dt: '2025-09-23',
                srid: 'SRID123',
                delivery_rub: 5,
                ppvz_for_pay: 50,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 3,
                assembly_id: 5001,
            },
        ];

        getTransactions.mockResolvedValueOnce(mockTransactions);

        const result = await command.execute(context);

        expect(getTransactions).toHaveBeenCalledWith({
            from: dateFrom,
            to: dateTo,
        });
        expect(result.transactions).toHaveLength(2);
        expect(result.transactions).toEqual([
            mockTransactions[0],
            mockTransactions[2],
        ]);
        expect(result.dateTo).toEqual(dateTo);
    });

    it('should use current date if dateTo not provided', async () => {
        const dateFrom = new Date('2025-09-21');
        const context: IWbTransactionProcessingContext = {
            dateFrom,
            stickerId: '42197484529',
            srid: 'SRID123',
        };

        getTransactions.mockResolvedValueOnce([]);

        const result = await command.execute(context);

        expect(getTransactions).toHaveBeenCalledWith({
            from: dateFrom,
            to: expect.any(Date),
        });
        expect(result.dateTo).toBeInstanceOf(Date);
    });
});
