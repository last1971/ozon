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

    /**
     * Генерирует embedding для текста (только OpenAI)
     */
    async generateEmbedding(text: string, model = 'text-embedding-3-small'): Promise<number[]> {
        const provider = this.providers.get(AIProviderName.OPENAI) as OpenAIProvider;
        return provider.generateEmbedding(text, model);
    }

    /**
     * Генерирует embeddings для нескольких текстов батчем (только OpenAI)
     */
    async generateEmbeddings(texts: string[], model = 'text-embedding-3-small'): Promise<number[][]> {
        const provider = this.providers.get(AIProviderName.OPENAI) as OpenAIProvider;
        return provider.generateEmbeddings(texts, model);
    }

    async shortenTitle(title: string, maxLength = 60): Promise<{ title: string; original: string }> {
        if (title.length <= maxLength) return { title, original: title };

        const response = await this.chat(
            AIProviderName.ANTHROPIC,
            [
                {
                    role: 'user',
                    content: `Сократи название товара до ${maxLength} символов. Правила:
- Сохрани модель/артикул, ключевые характеристики (напряжение, мощность, размер)
- Обязательно сохрани количество (шт, комплект, набор, упаковка) если указано
- Убери бренд в скобках, лишние запятые, избыточные слова
- Не добавляй ничего от себя
- Ответь ТОЛЬКО сокращённым названием, без пояснений

Название: ${title}`,
                },
            ],
            { model: 'claude-haiku-4-5-20251001', max_tokens: 100 },
        );

        const shortened = response.content.trim();
        if (shortened.length > maxLength) {
            this.logger.warn(`shortenTitle: AI returned ${shortened.length} chars (>${maxLength}): "${shortened}"`);
        }
        return { title: shortened, original: title };
    }

    private getProvider(name: AIProviderName): AIProvider {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new Error(`Unknown AI provider: ${name}`);
        }
        return provider;
    }
}
