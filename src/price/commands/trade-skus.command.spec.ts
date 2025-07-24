import { TradeSkusCommand } from './trade-skus.command';
import { ExtraGoodService } from 'src/good/extra.good.service';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('TradeSkusCommand', () => {
  it('should call tradeSkusToServiceSkus and set ozonSkus in context', async () => {
    const extraGoodService = {
      tradeSkusToServiceSkus: jest.fn().mockReturnValue(['ozon1', 'ozon2'])
    } as any as ExtraGoodService;
    const command = new TradeSkusCommand(extraGoodService);
    const context: IGoodsProcessingContext = { skus: ['sku1', 'sku2'] };
    await command.execute(context);
    expect(extraGoodService.tradeSkusToServiceSkus).toHaveBeenCalledWith(['sku1', 'sku2'], expect.anything());
    expect(context.ozonSkus).toEqual(['ozon1', 'ozon2']);
  });
}); 