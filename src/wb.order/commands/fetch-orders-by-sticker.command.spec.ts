import { Test, TestingModule } from '@nestjs/testing';
import { FetchOrdersByStickerCommand } from './fetch-orders-by-sticker.command';
import { WbOrderService } from '../wb.order.service';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';

describe('FetchOrdersByStickerCommand', () => {
    let command: FetchOrdersByStickerCommand;
    const getOrders = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FetchOrdersByStickerCommand,
                {
                    provide: WbOrderService,
                    useValue: { getOrders },
                },
            ],
        }).compile();

        getOrders.mockClear();
        command = module.get<FetchOrdersByStickerCommand>(FetchOrdersByStickerCommand);
    });

    it('should be defined', () => {
        expect(command).toBeDefined();
    });

    it('should skip if srid already found', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
        };

        const result = await command.execute(context);

        expect(getOrders).not.toHaveBeenCalled();
        expect(result).toEqual(context);
    });

    it('should find order by sticker (string)', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        getOrders.mockResolvedValueOnce([
            { sticker: '42197484529', srid: 'SRID123' },
            { sticker: '11111111111', srid: 'SRID456' },
        ]);

        const result = await command.execute(context);

        expect(getOrders).toHaveBeenCalledWith('2025-09-21', 0);
        expect(result).toEqual({
            ...context,
            srid: 'SRID123',
        });
    });

    it('should find order by sticker (number)', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        getOrders.mockResolvedValueOnce([
            { sticker: 42197484529, srid: 'SRID123' },
            { sticker: 11111111111, srid: 'SRID456' },
        ]);

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            srid: 'SRID123',
        });
    });

    it('should continue chain if no orders found', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        getOrders.mockResolvedValueOnce([]);

        const result = await command.execute(context);

        expect(result).toEqual(context);
    });

    it('should continue chain if order not found', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '99999999999',
        };

        getOrders.mockResolvedValueOnce([
            { sticker: '42197484529', srid: 'SRID123' },
            { sticker: '11111111111', srid: 'SRID456' },
        ]);

        const result = await command.execute(context);

        expect(result).toEqual(context);
    });
});
