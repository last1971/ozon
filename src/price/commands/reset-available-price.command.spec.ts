import { ResetAvailablePriceCommand } from './reset-available-price.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('ResetAvailablePriceCommand', () => {
  it('should call goodService.resetAvailablePrice with skus', async () => {
    const goodService = { resetAvailablePrice: jest.fn() };
    const command = new ResetAvailablePriceCommand(goodService as any);
    const context: IGoodsProcessingContext = { skus: ['sku1', 'sku2'] };
    await command.execute(context);
    expect(goodService.resetAvailablePrice).toHaveBeenCalledWith(['sku1', 'sku2']);
  });
}); 