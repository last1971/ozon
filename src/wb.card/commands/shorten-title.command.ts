import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';
import { AIService } from '../../ai/ai.service';

@Injectable()
export class ShortenTitleCommand implements ICommandAsync<IWbCreateCardContext> {
    constructor(private readonly aiService: AIService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        if (!context.title) {
            const { title } = await this.aiService.shortenTitle(context.ozonName || context.productName, 60);
            context.title = title;
        }
        return context;
    }
}
