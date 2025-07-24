import { ValidateSkusNotEmptyCommand } from './validate-skus-not-empty.command';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

describe('ValidateSkusNotEmptyCommand', () => {
  it('should throw if skus is empty', async () => {
    const command = new ValidateSkusNotEmptyCommand();
    const context: IGoodsProcessingContext = { skus: [] };
    await expect(command.execute(context)).rejects.toThrow('No incoming goods SKUs provided');
  });
  it('should not throw if skus is not empty', async () => {
    const command = new ValidateSkusNotEmptyCommand();
    const context: IGoodsProcessingContext = { skus: ['sku1'] };
    await expect(command.execute(context)).resolves.toEqual(context);
  });
}); 