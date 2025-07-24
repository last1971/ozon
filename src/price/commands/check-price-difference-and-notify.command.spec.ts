import { CheckPriceDifferenceAndNotifyCommand } from './check-price-difference-and-notify.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

describe('CheckPriceDifferenceAndNotifyCommand', () => {
  it('should call extraPriceService.checkPriceDifferenceAndNotify with ozonSkus', async () => {
    const extraPriceService = { checkPriceDifferenceAndNotify: jest.fn() };
    const command = new CheckPriceDifferenceAndNotifyCommand(extraPriceService as any);
    const context: IGoodsProcessingContext = { skus: ['sku1'], ozonSkus: ['ozon1', 'ozon2'] };
    await command.execute(context);
    expect(extraPriceService.checkPriceDifferenceAndNotify).toHaveBeenCalledWith(['ozon1', 'ozon2']);
  });
}); 