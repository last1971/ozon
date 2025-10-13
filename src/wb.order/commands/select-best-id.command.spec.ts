import { Test, TestingModule } from '@nestjs/testing';
import { SelectBestIdCommand } from './select-best-id.command';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { WbTransactionDto } from '../dto/wb.transaction.dto';

describe('SelectBestIdCommand', () => {
    let command: SelectBestIdCommand;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [SelectBestIdCommand],
        }).compile();

        command = module.get<SelectBestIdCommand>(SelectBestIdCommand);
    });

    it('should be defined', () => {
        expect(command).toBeDefined();
    });

    it('should use srid if no transactions', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            transactions: [],
        };

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            selectedId: 'SRID123',
            selectedIdType: 'srid',
        });
    });

    it('should stop chain if no transactions and no srid', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            transactions: [],
        };

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            stopChain: true,
        });
    });

    it('should select most frequent assembly_id', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            transactions: [
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
                    srid: 'SRID123',
                    delivery_rub: 5,
                    ppvz_for_pay: 50,
                    additional_payment: 0,
                    penalty: 0,
                    rrd_id: 2,
                    assembly_id: 5001,
                },
                {
                    order_dt: '2025-09-23',
                    srid: 'SRID123',
                    delivery_rub: 3,
                    ppvz_for_pay: 30,
                    additional_payment: 0,
                    penalty: 0,
                    rrd_id: 3,
                    assembly_id: 5002,
                },
            ] as WbTransactionDto[],
        };

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            selectedId: '5001',
            selectedIdType: 'assembly_id',
        });
    });

    it('should use srid if all assembly_id are null or 0', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            transactions: [
                {
                    order_dt: '2025-09-21',
                    srid: 'SRID123',
                    delivery_rub: 10,
                    ppvz_for_pay: 100,
                    additional_payment: 0,
                    penalty: 0,
                    rrd_id: 1,
                    assembly_id: null,
                },
                {
                    order_dt: '2025-09-22',
                    srid: 'SRID123',
                    delivery_rub: 5,
                    ppvz_for_pay: 50,
                    additional_payment: 0,
                    penalty: 0,
                    rrd_id: 2,
                    assembly_id: 0,
                },
            ] as WbTransactionDto[],
        };

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            selectedId: 'SRID123',
            selectedIdType: 'srid',
        });
    });

    it('should handle mixed assembly_id (some 0, some valid)', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            transactions: [
                {
                    order_dt: '2025-09-21',
                    srid: 'SRID123',
                    delivery_rub: 10,
                    ppvz_for_pay: 100,
                    additional_payment: 0,
                    penalty: 0,
                    rrd_id: 1,
                    assembly_id: 0,
                },
                {
                    order_dt: '2025-09-22',
                    srid: 'SRID123',
                    delivery_rub: 5,
                    ppvz_for_pay: 50,
                    additional_payment: 0,
                    penalty: 0,
                    rrd_id: 2,
                    assembly_id: 5001,
                },
            ] as WbTransactionDto[],
        };

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            selectedId: '5001',
            selectedIdType: 'assembly_id',
        });
    });
});
