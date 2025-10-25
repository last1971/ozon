import { CheckVatCommand } from './check-vat.command';
import { IVatProcessingContext } from '../../interfaces/i.vat.processing.context';
import { IVatUpdateable } from '../../interfaces/i.vat.updateable';

describe('CheckVatCommand', () => {
    let command: CheckVatCommand;
    let mockService: jest.Mocked<IVatUpdateable>;
    let mockLogger: { log: jest.Mock; error: jest.Mock };

    beforeEach(() => {
        command = new CheckVatCommand();

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

    it('should check VAT and find mismatches', async () => {
        const mismatches = [
            { offer_id: 'SKU1', current_vat: 10, expected_vat: 20 },
            { offer_id: 'SKU2', current_vat: 0, expected_vat: 20 },
        ];

        mockService.checkVatForAll.mockResolvedValue(mismatches);

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            limit: 1000,
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.checkVatForAll).toHaveBeenCalledWith(20, 1000);
        expect(result.mismatches).toEqual(mismatches);
        expect(result.stopChain).toBeUndefined();
        expect(mockLogger.log).toHaveBeenCalledWith('Начинаем проверку НДС. Ожидаемая ставка: 20%, лимит: 1000');
        expect(mockLogger.log).toHaveBeenCalledWith('Проверка завершена. Найдено несоответствий: 2');
    });

    it('should handle no mismatches found', async () => {
        mockService.checkVatForAll.mockResolvedValue([]);

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            limit: 500,
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.checkVatForAll).toHaveBeenCalledWith(20, 500);
        expect(result.mismatches).toEqual([]);
        expect(mockLogger.log).toHaveBeenCalledWith('Проверка завершена. Найдено несоответствий: 0');
    });

    it('should stop chain if expectedVat is missing', async () => {
        const context: IVatProcessingContext = {
            service: mockService,
            limit: 1000,
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(mockService.checkVatForAll).not.toHaveBeenCalled();
        expect(result.stopChain).toBe(true);
        expect(mockLogger.error).toHaveBeenCalledWith('expectedVat не указан в контексте');
    });

    it('should stop chain on error', async () => {
        mockService.checkVatForAll.mockRejectedValue(new Error('API Error'));

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            limit: 1000,
            logger: mockLogger,
        };

        const result = await command.execute(context);

        expect(result.stopChain).toBe(true);
        expect(mockLogger.error).toHaveBeenCalledWith('Ошибка при проверке НДС: API Error');
    });

    it('should log first 5 mismatches as examples', async () => {
        const mismatches = [
            { offer_id: 'SKU1', current_vat: 10, expected_vat: 20 },
            { offer_id: 'SKU2', current_vat: 0, expected_vat: 20 },
            { offer_id: 'SKU3', current_vat: 5, expected_vat: 20 },
            { offer_id: 'SKU4', current_vat: 7, expected_vat: 20 },
            { offer_id: 'SKU5', current_vat: 10, expected_vat: 20 },
            { offer_id: 'SKU6', current_vat: 0, expected_vat: 20 },
        ];

        mockService.checkVatForAll.mockResolvedValue(mismatches);

        const context: IVatProcessingContext = {
            service: mockService,
            expectedVat: 20,
            logger: mockLogger,
        };

        await command.execute(context);

        expect(mockLogger.log).toHaveBeenCalledWith(
            expect.stringContaining('Примеры несоответствий (первые 5):')
        );
    });
});
