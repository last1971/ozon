import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

@Injectable()
export class LogResultProcessingMessageCommand implements ICommandAsync<IGoodsProcessingContext> {
  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    if (context.resultProcessingMessage && context.logger) {
      context.logger.log(context.resultProcessingMessage);
    }
    return context;
  }
} 