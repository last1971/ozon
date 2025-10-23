import { UpdateVatCommand } from './update-vat.command';
import { IVatProcessingContext } from '../../interfaces/i.vat.processing.context';
import { IVatUpdateable } from '../../interfaces/i.vat.updateable';

describe('UpdateVatCommand', () => {
    let command: UpdateVatCommand;
    let mockService: jest.Mocked<IVatUpdateable>;
    let mockLogger: { log: jest.Mock; error: jest.Mock };

    beforeEach(() => {
        command = new UpdateVatCommand();

        mockService = {
            checkVatForAll: jest.fn(),
            updateVat: jest.fn(),
            vatToNumber: jest.fn(),
            numberToVat: jest.fn(),
        };

        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        };
    });

    it('should update VAT for offer_ids from mismatches', async () => {
        const mismatches = [
            { offer_id: 'SKU1', current_vat: 10, expected_vat: 20 },
            { offer_id: 'SKU2', current_vat: 0, expected_vat: 20 },
        ];

        mockService.updateVat.mockResolvedValue({ updated: true });

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            mismatches,
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.updateVat).toHaveBeenCalledWith(['SKU1', 'SKU2'], 20);
        expect(result.updateResult).toEqual({ updated: true });
        expect(result.stopChain).toBeUndefined();
        expect(mockLogger.log).toHaveBeenCalledWith('Начинаем обновление НДС для 2 товаров. Новая ставка: 20%');
        expect(mockLogger.log).toHaveBeenCalledWith('Обновление НДС завершено для 2 товаров');
    });

    it('should skip update if no mismatches', async () => {
        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            mismatches: [],
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.updateVat).not.toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('Нет товаров для обновления НДС (несоответствий не найдено)');
        expect(result.stopChain).toBeUndefined();
    });

    it('should skip update if mismatches is undefined', async () => {
        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.updateVat).not.toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('Нет товаров для обновления НДС (несоответствий не найдено)');
    });

    it('should stop chain if expectedVat is missing', async () => {
        const context: IVatProcessingContext = {
            service: mockService,
            mismatches: [{ offer_id: 'SKU1', current_vat: 10, expected_vat: 20 }],
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.updateVat).not.toHaveBeenCalled();
        expect(result.stopChain).toBe(true);
        expect(mockLogger.error).toHaveBeenCalledWith('expectedVat не указан в контексте');
    });

    it('should stop chain on error', async () => {
        mockService.updateVat.mockRejectedValue(new Error('Update failed'));

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            mismatches: [{ offer_id: 'SKU1', current_vat: 10, expected_vat: 20 }],
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(result.stopChain).toBe(true);
        expect(mockLogger.error).toHaveBeenCalledWith('Ошибка при обновлении НДС: Update failed');
    });

    it('should extract offer_ids correctly from multiple mismatches', async () => {
        const mismatches = [
            { offer_id: 'ABC', current_vat: 0, expected_vat: 10 },
            { offer_id: 'DEF', current_vat: 5, expected_vat: 10 },
            { offer_id: 'GHI', current_vat: 20, expected_vat: 10 },
        ];

        mockService.updateVat.mockResolvedValue({});

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 10,
            mismatches,
            logger: mockLogger,
        };

        await command.execute(context);

        expect(mockService.updateVat).toHaveBeenCalledWith(['ABC', 'DEF', 'GHI'], 10);
    });
});
