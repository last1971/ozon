import { SetResultProcessingMessageCommand } from './set-result-processing-message.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('SetResultProcessingMessageCommand', () => {
  it('should set resultProcessingMessage in context', async () => {
    const command = new SetResultProcessingMessageCommand();
    const context: IGoodsProcessingContext = { skus: ['sku1', 'sku2'] };
    await command.execute(context);
    expect(context.resultProcessingMessage).toBe('Successfully updated prices for 2 SKUs after incoming goods event');
  });
}); 