import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';
import { AIService } from '../../ai/ai.service';
import { AIProviderName } from '../../ai/interfaces';
import { WB_CHARACTERISTICS_SYSTEM_PROMPT, buildWbCharcsPrompt } from '../prompts/wb-characteristics.prompt';

@Injectable()
export class GenerateWbCharcsCommand implements ICommandAsync<IWbCreateCardContext> {
    private readonly logger = new Logger(GenerateWbCharcsCommand.name);

    constructor(private readonly aiService: AIService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        if (!context.charcs?.length) {
            context.stopChain = true;
            context.error_message = 'Нет характеристик WB для заполнения';
            return context;
        }

        const userPrompt = buildWbCharcsPrompt(
            context.productName,
            context.description,
            context.charcs,
        );

        const response = await this.aiService.chat(
            AIProviderName.ANTHROPIC,
            [
                {
                    role: 'system',
                    content: WB_CHARACTERISTICS_SYSTEM_PROMPT,
                    cache_control: { type: 'ephemeral' },
                },
                { role: 'user', content: userPrompt },
            ],
            {
                model: 'claude-sonnet-4-6',
                max_tokens: 2048,
                temperature: 0.3,
                web_search: context.webSearch,
            },
        );

        try {
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON in AI response');
            const parsed = JSON.parse(jsonMatch[0]);
            context.aiCharacteristics = parsed.characteristics || [];
        } catch (e) {
            this.logger.error(`Failed to parse AI response: ${e.message}`);
            context.stopChain = true;
            context.error_message = `AI вернул невалидный JSON: ${e.message}`;
            return context;
        }

        const inputTokens = response.usage?.input_tokens || 0;
        const outputTokens = response.usage?.output_tokens || 0;
        context.aiCost = {
            tokens: inputTokens + outputTokens,
            cost: this.aiService.estimateCost(AIProviderName.ANTHROPIC, inputTokens, outputTokens, 'claude-sonnet-4-6'),
        };

        this.logger.log(`AI заполнил ${context.aiCharacteristics.length} характеристик, cost: $${context.aiCost.cost.toFixed(4)}`);
        return context;
    }
}
