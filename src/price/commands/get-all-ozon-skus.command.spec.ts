import { GetAllOzonSkusCommand } from './get-all-ozon-skus.command';
import { ProductService } from '../../product/product.service';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

describe('GetAllOzonSkusCommand', () => {
  let command: GetAllOzonSkusCommand;
  let productService: jest.Mocked<ProductService>;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    productService = {
      skuList: [],
      loadSkuList: jest.fn(),
    } as any;

    command = new GetAllOzonSkusCommand(productService);
  });

  it('should load SKU list when it is empty', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: [],
      logger: mockLogger,
    };

    productService.skuList = [];
    productService.loadSkuList.mockResolvedValue(undefined);

    await command.execute(context);

    expect(productService.loadSkuList).toHaveBeenCalled();
    expect(context.ozonSkus).toEqual([]);
    expect(mockLogger.log).toHaveBeenCalledWith('Получено 0 Ozon SKU для массового обновления');
  });

  it('should not load SKU list when it already has items', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: [],
      logger: mockLogger,
    };

    const testSkus = ['SKU1', 'SKU2', 'SKU3'];
    productService.skuList = testSkus;

    await command.execute(context);

    expect(productService.loadSkuList).not.toHaveBeenCalled();
    expect(context.ozonSkus).toEqual(testSkus);
    expect(mockLogger.log).toHaveBeenCalledWith('Получено 3 Ozon SKU для массового обновления');
  });

  it('should set ozonSkus from productService.skuList', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: [],
      logger: mockLogger,
    };

    const testSkus = ['SKU1', 'SKU2-10', 'SKU3'];
    productService.skuList = testSkus;

    const result = await command.execute(context);

    expect(result.ozonSkus).toEqual(testSkus);
    expect(result).toBe(context);
  });

  it('should work without logger', async () => {
    const context: IGoodsProcessingContext = {
      skus: [],
      ozonSkus: [],
    };

    const testSkus = ['SKU1'];
    productService.skuList = testSkus;

    await command.execute(context);

    expect(context.ozonSkus).toEqual(testSkus);
    // Should not throw error when logger is undefined
  });
});