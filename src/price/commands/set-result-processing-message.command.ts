import { Injectable } from '@nestjs/common';
import { ICommandAsync } from 'src/interfaces/i.command.acync';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';

@Injectable()
export class SetResultProcessingMessageCommand implements ICommandAsync<IGoodsProcessingContext> {
    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        context.resultProcessingMessage = context.incomingFailures?.length
            ? `Приход: незавершённых действий ${context.incomingFailures.length}`
            : `Successfully updated prices for ${context.skus.length} SKUs after incoming goods event`;
        return context;
    }
}
