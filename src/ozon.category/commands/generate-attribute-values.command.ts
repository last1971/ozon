import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { AIService } from '../../ai/ai.service';
import { AIProviderName } from '../../ai/interfaces';
import {
    PRODUCT_ATTRIBUTES_SYSTEM_PROMPT,
    buildProductAttributesPrompt,
    DimensionsInput,
} from '../prompts/product-attributes.prompt';

@Injectable()
export class GenerateAttributeValuesCommand implements ICommandAsync<IProductCreateContext> {
    constructor(private readonly aiService: AIService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const attributes = context.required_attributes || [];
        const name = context.generated_name || context.input.text;
        const provider = context.input.provider || AIProviderName.ANTHROPIC;
        const { input } = context;

        const dimensions: DimensionsInput = {
            depth: input.package_depth || 0,
            width: input.package_width || 0,
            height: input.package_height || 0,
            weight: input.weight_without_packaging || 0,
            weightWithPackaging: input.weight_with_packaging || 0,
        };

        context.logger?.log(`Генерация атрибутов через AI (${attributes.length} атрибутов)`);

        const userPrompt = buildProductAttributesPrompt(name, context.input.text, attributes, dimensions);

        const response = await this.aiService.chat(
            provider,
            [
                {
                    role: 'system',
                    content: PRODUCT_ATTRIBUTES_SYSTEM_PROMPT,
                    cache_control: { type: 'ephemeral' },
                },
                { role: 'user', content: userPrompt },
            ],
            {
                model: context.input.model,
                max_tokens: 2048,
                temperature: 0.2,
                web_search: true,
            },
        );

        const totalTokens = response.usage.input_tokens + response.usage.output_tokens;
        const cost = this.aiService.estimateCost(
            provider,
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.model,
        );

        context.ai_cost = { tokens: totalTokens, cost };

        // Парсим JSON из ответа AI
        try {
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                context.description = parsed.description || '';
                context.hashtags = parsed.hashtags || '';
                context.ai_attributes = (parsed.attributes || []).map((a: any) => ({
                    ...a,
                    value: String(a.value),
                }));

                // Записываем габариты от AI в input, если они не были заданы
                if (parsed.dimensions) {
                    const d = parsed.dimensions;
                    if (!input.package_depth && d.depth) {
                        input.package_depth = Math.round(d.depth);
                    }
                    if (!input.package_width && d.width) {
                        input.package_width = Math.round(d.width);
                    }
                    if (!input.package_height && d.height) {
                        input.package_height = Math.round(d.height);
                    }
                    if (!input.weight_without_packaging && d.weight) {
                        input.weight_without_packaging = Math.round(d.weight);
                    }
                    if (!input.weight_with_packaging && d.weight_with_packaging) {
                        input.weight_with_packaging = Math.round(d.weight_with_packaging);
                    }
                    context.logger?.log(
                        `Габариты из AI: ${input.package_depth}×${input.package_width}×${input.package_height}мм, ` +
                        `вес: ${input.weight_without_packaging}/${input.weight_with_packaging}г`,
                    );
                }
            }
        } catch (error) {
            context.logger?.log(`Ошибка парсинга JSON от AI: ${(error as Error).message}`);
            context.logger?.log(`Ответ AI: ${response.content}`);
        }

        context.logger?.log(
            `AI: описание ${context.description?.length || 0} символов, ` +
            `хэштеги: "${context.hashtags}", ` +
            `атрибутов: ${context.ai_attributes?.length || 0}, ` +
            `tokens: ${totalTokens}, cost: $${cost.toFixed(6)}`,
        );
        return context;
    }
}
