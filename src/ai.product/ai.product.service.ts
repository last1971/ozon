import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../ai/ai.service';
import { AIProviderName } from '../ai/interfaces';
import {
    GenerateNameResponseDto,
    GenerateAttributesRequestDto,
    GenerateAttributesResponseDto,
    GeneratedAttributeDto,
} from './dto';
import {
    NAME_GENERATION_SYSTEM_PROMPT,
    ATTRIBUTES_GENERATION_SYSTEM_PROMPT,
    buildAttributesGenerationPrompt,
} from './prompts';

@Injectable()
export class AIProductService {
    private logger = new Logger(AIProductService.name);
    private defaultProvider = AIProviderName.ANTHROPIC;

    constructor(private aiService: AIService) {}

    async generateName(
        text: string,
        provider: AIProviderName = this.defaultProvider,
        model?: string,
    ): Promise<GenerateNameResponseDto> {
        const response = await this.aiService.chat(
            provider,
            [
                {
                    role: 'system',
                    content: NAME_GENERATION_SYSTEM_PROMPT,
                    cache_control: { type: 'ephemeral' },
                },
                { role: 'user', content: text },
            ],
            {
                model,
                max_tokens: 256,
                temperature: 0.3,
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

        this.logger.log(
            `Generated name, tokens: ${totalTokens}, cost: $${cost.toFixed(6)}`,
        );

        return {
            name: response.content.trim(),
            tokens_used: totalTokens,
            cost,
        };
    }

    async generateAttributes(
        request: GenerateAttributesRequestDto,
        provider: AIProviderName = this.defaultProvider,
    ): Promise<GenerateAttributesResponseDto> {
        const userPrompt = buildAttributesGenerationPrompt(
            request.product_data as Record<string, any>,
            request.required_attributes,
        );

        const response = await this.aiService.chat(
            provider,
            [
                {
                    role: 'system',
                    content: ATTRIBUTES_GENERATION_SYSTEM_PROMPT,
                    cache_control: { type: 'ephemeral' },
                },
                { role: 'user', content: userPrompt },
            ],
            {
                max_tokens: 2048,
                temperature: 0.2,
            },
        );

        let attributes: GeneratedAttributeDto[] = [];
        try {
            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                attributes = JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            this.logger.error(`Failed to parse attributes JSON: ${(error as Error).message}`);
        }

        const totalTokens = response.usage.input_tokens + response.usage.output_tokens;
        const cost = this.aiService.estimateCost(
            provider,
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.model,
        );

        this.logger.log(
            `Generated ${attributes.length} attributes for type_id ${request.type_id}, tokens: ${totalTokens}`,
        );

        return {
            attributes,
            tokens_used: totalTokens,
            cost,
        };
    }
}
