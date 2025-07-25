import { LogResultProcessingMessageCommand } from './log-result-processing-message.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('LogResultProcessingMessageCommand', () => {
  it('should call logger.log with resultProcessingMessage if both exist', async () => {
    const logger = { log: jest.fn() };
    const command = new LogResultProcessingMessageCommand();
    const context: IGoodsProcessingContext = {
      skus: ['sku1'],
      resultProcessingMessage: 'msg',
      logger,
    };
    await command.execute(context);
    expect(logger.log).toHaveBeenCalledWith('msg');
  });
  it('should not throw if logger or message is missing', async () => {
    const command = new LogResultProcessingMessageCommand();
    const context: IGoodsProcessingContext = { skus: ['sku1'] };
    await expect(command.execute(context)).resolves.toEqual(context);
  });
}); 