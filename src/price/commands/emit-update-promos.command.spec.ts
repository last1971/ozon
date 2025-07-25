import { EmitUpdatePromosCommand } from './emit-update-promos.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('EmitUpdatePromosCommand', () => {
  it('should call eventEmitter.emit with update.promos and ozonSkus', async () => {
    const eventEmitter = { emit: jest.fn() };
    const command = new EmitUpdatePromosCommand(eventEmitter as any);
    const context: IGoodsProcessingContext = { skus: ['sku1'], ozonSkus: ['ozon1', 'ozon2'] };
    await command.execute(context);
    expect(eventEmitter.emit).toHaveBeenCalledWith('update.promos', ['ozon1', 'ozon2']);
  });
}); 