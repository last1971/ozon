import { Injectable, Logger } from '@nestjs/common';
import {
    AIProvider,
    AIProviderName,
    AIFeature,
    AIChatMessage,
    AIChatOptions,
    AIChatResponse,
    AIStreamChunk,
    AIModelInfo,
} from './interfaces';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { YandexProvider } from './providers/yandex.provider';

@Injectable()
export class AIService {
    private logger = new Logger(AIService.name);
    private providers: Map<AIProviderName, AIProvider>;

    constructor(
        anthropicProvider: AnthropicProvider,
        openaiProvider: OpenAIProvider,
        yandexProvider: YandexProvider,
    ) {
        this.providers = new Map<AIProviderName, AIProvider>([
            [AIProviderName.ANTHROPIC, anthropicProvider],
            [AIProviderName.OPENAI, openaiProvider],
            [AIProviderName.YANDEX, yandexProvider],
        ]);
    }

    async chat(
        provider: AIProviderName,
        messages: AIChatMessage[],
        options?: AIChatOptions,
    ): Promise<AIChatResponse> {
        const p = this.getProvider(provider);
        this.logger.log(`Chat request to ${provider}, model: ${options?.model || 'default'}`);
        return p.chat(messages, options);
    }

    async *chatStream(
        provider: AIProviderName,
        messages: AIChatMessage[],
        options?: AIChatOptions,
    ): AsyncIterable<AIStreamChunk> {
        const p = this.getProvider(provider);
        this.logger.log(`Stream chat request to ${provider}, model: ${options?.model || 'default'}`);
        yield* p.chatStream(messages, options);
    }

    getModels(provider?: AIProviderName): AIModelInfo[] {
        if (provider) {
            return this.getProvider(provider).getModels();
        }
        const allModels: AIModelInfo[] = [];
        for (const p of this.providers.values()) {
            allModels.push(...p.getModels());
        }
        return allModels;
    }

    supportsFeature(provider: AIProviderName, feature: AIFeature): boolean {
        return this.getProvider(provider).supportsFeature(feature);
    }

    estimateCost(
        provider: AIProviderName,
        inputTokens: number,
        outputTokens: number,
        model?: string,
    ): number {
        return this.getProvider(provider).estimateCost(inputTokens, outputTokens, model);
    }

    private getProvider(name: AIProviderName): AIProvider {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new Error(`Unknown AI provider: ${name}`);
        }
        return provider;
    }
}
