import { Injectable } from '@nestjs/common';
import { ICommandAsync } from 'src/interfaces/i.command.acync';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

@Injectable()
export class ValidateSkusNotEmptyCommand implements ICommandAsync<IGoodsProcessingContext> {
  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    if (!context.skus || context.skus.length === 0) {
      throw new Error('No incoming goods SKUs provided');
    }
    return context;
  }
} 