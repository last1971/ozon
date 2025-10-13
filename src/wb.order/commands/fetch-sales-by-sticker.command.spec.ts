import { Test, TestingModule } from '@nestjs/testing';
import { FetchSalesByStickerCommand } from './fetch-sales-by-sticker.command';
import { WbOrderService } from '../wb.order.service';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';

describe('FetchSalesByStickerCommand', () => {
    let command: FetchSalesByStickerCommand;
    const getSales = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FetchSalesByStickerCommand,
                {
                    provide: WbOrderService,
                    useValue: { getSales },
                },
            ],
        }).compile();

        getSales.mockClear();
        command = module.get<FetchSalesByStickerCommand>(FetchSalesByStickerCommand);
    });

    it('should be defined', () => {
        expect(command).toBeDefined();
    });

    it('should find sale by sticker (string)', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        getSales.mockResolvedValueOnce([
            { sticker: '42197484529', srid: 'SRID123' },
            { sticker: '11111111111', srid: 'SRID456' },
        ]);

        const result = await command.execute(context);

        expect(getSales).toHaveBeenCalledWith('2025-09-21');
        expect(result).toEqual({
            ...context,
            srid: 'SRID123',
        });
    });

    it('should find sale by sticker (number)', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        getSales.mockResolvedValueOnce([
            { sticker: 42197484529, srid: 'SRID123' },
            { sticker: 11111111111, srid: 'SRID456' },
        ]);

        const result = await command.execute(context);

        expect(result).toEqual({
            ...context,
            srid: 'SRID123',
        });
    });

    it('should continue chain if no sales found', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        getSales.mockResolvedValueOnce([]);

        const result = await command.execute(context);

        expect(result).toEqual(context);
    });

    it('should continue chain if sale not found', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '99999999999',
        };

        getSales.mockResolvedValueOnce([
            { sticker: '42197484529', srid: 'SRID123' },
            { sticker: '11111111111', srid: 'SRID456' },
        ]);

        const result = await command.execute(context);

        expect(result).toEqual(context);
    });
});
