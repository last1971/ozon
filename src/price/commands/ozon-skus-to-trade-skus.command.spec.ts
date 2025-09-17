import { OzonSkusToTradeSkusCommand } from './ozon-skus-to-trade-skus.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

// Мокаем функцию goodCode из helpers
jest.mock('../../helpers', () => ({
  goodCode: jest.fn((value) => {
    // Мокаем логику goodCode: удаляем всё после дефиса
    return value.offer_id.toString().replace(/-.*/g, '');
  }),
}));

describe('OzonSkusToTradeSkusCommand', () => {
  let command: OzonSkusToTradeSkusCommand;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    command = new OzonSkusToTradeSkusCommand();
  });

  it('should convert Ozon SKUs to trade codes', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: ['ABC-123', 'DEF-456', 'GHI'],
      logger: mockLogger,
    };

    const result = await command.execute(context);

    expect(result.skus).toEqual(['ABC', 'DEF', 'GHI']);
    expect(mockLogger.log).toHaveBeenCalledWith('Конвертировано 3 Ozon SKU в 3 уникальных trade кодов');
  });

  it('should remove duplicates when converting SKUs to trade codes', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: ['ABC-123', 'ABC-456', 'DEF-789', 'ABC'],
      logger: mockLogger,
    };

    const result = await command.execute(context);

    expect(result.skus).toEqual(['ABC', 'DEF']);
    expect(mockLogger.log).toHaveBeenCalledWith('Конвертировано 4 Ozon SKU в 2 уникальных trade кодов');
  });

  it('should handle empty ozonSkus array', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: [],
      logger: mockLogger,
    };

    const result = await command.execute(context);

    expect(result.skus).toEqual([]);
    expect(mockLogger.log).toHaveBeenCalledWith('Нет Ozon SKU для конвертации в trade коды');
  });

  it('should handle undefined ozonSkus', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      logger: mockLogger,
    };

    const result = await command.execute(context);

    expect(result.skus).toEqual([]);
    expect(mockLogger.log).toHaveBeenCalledWith('Нет Ozon SKU для конвертации в trade коды');
  });

  it('should work without logger', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: ['ABC-123', 'DEF-456'],
    };

    const result = await command.execute(context);

    expect(result.skus).toEqual(['ABC', 'DEF']);
    // Should not throw error when logger is undefined
  });

  it('should preserve context reference', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: ['ABC-123'],
      logger: mockLogger,
    };

    const result = await command.execute(context);

    expect(result).toBe(context);
  });

  it('should handle SKUs without dashes', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: ['ABC123', 'DEF456'],
      logger: mockLogger,
    };

    const result = await command.execute(context);

    expect(result.skus).toEqual(['ABC123', 'DEF456']);
    expect(mockLogger.log).toHaveBeenCalledWith('Конвертировано 2 Ozon SKU в 2 уникальных trade кодов');
  });
});