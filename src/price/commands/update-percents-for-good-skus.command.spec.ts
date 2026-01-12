import { UpdatePercentsForGoodSkusCommand } from './update-percents-for-good-skus.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('UpdatePercentsForGoodSkusCommand', () => {
  it('should call extraPriceService.updatePercentsForGoodSkus with ozonSkus and allSkus', async () => {
    const extraPriceService = { updatePercentsForGoodSkus: jest.fn() };
    const command = new UpdatePercentsForGoodSkusCommand(extraPriceService as any);
    const context: IGoodsProcessingContext = { skus: ['sku1', 'sku2'], ozonSkus: ['ozon1', 'ozon2'] };
    await command.execute(context);
    expect(extraPriceService.updatePercentsForGoodSkus).toHaveBeenCalledWith(['ozon1', 'ozon2'], ['sku1', 'sku2']);
  });

  it('should handle empty skus array', async () => {
    const extraPriceService = { updatePercentsForGoodSkus: jest.fn() };
    const command = new UpdatePercentsForGoodSkusCommand(extraPriceService as any);
    const context: IGoodsProcessingContext = { skus: [], ozonSkus: ['ozon1'] };
    await command.execute(context);
    expect(extraPriceService.updatePercentsForGoodSkus).toHaveBeenCalledWith(['ozon1'], []);
  });
}); 