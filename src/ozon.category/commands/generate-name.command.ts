import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { AIProductService } from '../../ai.product/ai.product.service';
import { AIProviderName } from '../../ai/interfaces';

@Injectable()
export class GenerateNameCommand implements ICommandAsync<IProductCreateContext> {
    constructor(private readonly aiProductService: AIProductService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const { text, provider, model } = context.input;
        context.logger?.log(`Генерация названия для: "${text}"`);

        const result = await this.aiProductService.generateName(
            text,
            provider || AIProviderName.ANTHROPIC,
            model,
        );

        context.generated_name = result.name;
        context.name_cost = { tokens: result.tokens_used || 0, cost: result.cost || 0 };

        context.logger?.log(`Название: "${result.name}" (tokens: ${result.tokens_used}, cost: $${result.cost?.toFixed(6)})`);
        return context;
    }
}
