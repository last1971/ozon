import { UpdatePriceForGoodSkusCommand } from './update-price-for-good-skus.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('UpdatePriceForGoodSkusCommand', () => {
  it('should call extraPriceService.updatePriceForGoodSkus with skus', async () => {
    const extraPriceService = { updatePriceForGoodSkus: jest.fn() };
    const command = new UpdatePriceForGoodSkusCommand(extraPriceService as any);
    const context: IGoodsProcessingContext = { skus: ['sku1', 'sku2'] };
    await command.execute(context);
    expect(extraPriceService.updatePriceForGoodSkus).toHaveBeenCalledWith(['sku1', 'sku2']);
  });
}); 