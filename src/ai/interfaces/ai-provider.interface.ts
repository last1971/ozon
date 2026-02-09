import { AIChatMessage, AIChatOptions } from './ai-message.interface';
import { AIChatResponse, AIStreamChunk } from './ai-response.interface';
import { AIModelInfo } from './ai-config.interface';

export enum AIProviderName {
    ANTHROPIC = 'anthropic',
    OPENAI = 'openai',
    YANDEX = 'yandex',
}

export enum AIFeature {
    STREAMING = 'streaming',
    PROMPT_CACHING = 'prompt_caching',
    VISION = 'vision',
    FUNCTION_CALLING = 'function_calling',
}

export interface AIProvider {
    readonly name: AIProviderName;

    chat(messages: AIChatMessage[], options?: AIChatOptions): Promise<AIChatResponse>;

    chatStream(messages: AIChatMessage[], options?: AIChatOptions): AsyncIterable<AIStreamChunk>;

    getModels(): AIModelInfo[];

    supportsFeature(feature: AIFeature): boolean;

    estimateCost(inputTokens: number, outputTokens: number, model?: string): number;
}
