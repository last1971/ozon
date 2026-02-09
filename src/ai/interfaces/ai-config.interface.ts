import { AIProviderName } from './ai-provider.interface';

export interface AIProviderConfig {
    apiKey: string;
    baseUrl?: string;
    orgId?: string;
    folderId?: string;
    defaultModel?: string;
    timeout?: number;
}

export interface AIModelInfo {
    id: string;
    name: string;
    provider: AIProviderName;
    maxTokens?: number;
    inputCostPer1M?: number;
    outputCostPer1M?: number;
}
