import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
    AIProvider,
    AIProviderName,
    AIFeature,
    AIChatMessage,
    AIChatOptions,
    AIChatResponse,
    AIStreamChunk,
    AIModelInfo,
} from '../interfaces';

@Injectable()
export class AnthropicProvider implements AIProvider {
    readonly name = AIProviderName.ANTHROPIC;
    private logger = new Logger(AnthropicProvider.name);
    private readonly baseUrl = 'https://api.anthropic.com';
    private proxyAgent: HttpsProxyAgent<string> | null = null;

    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {}

    private async getProxyAgent(): Promise<HttpsProxyAgent<string> | undefined> {
        if (this.proxyAgent) return this.proxyAgent;
        try {
            const proxyConfig = await this.vaultService.get('ai/proxy');
            if (proxyConfig?.URL) {
                this.proxyAgent = new HttpsProxyAgent(proxyConfig.URL as string);
                return this.proxyAgent;
            }
        } catch {
            // No proxy configured
        }
        return undefined;
    }

    async chat(messages: AIChatMessage[], options?: AIChatOptions): Promise<AIChatResponse> {
        const config = await this.vaultService.get('ai/anthropic');

        const systemMessage = messages.find((m) => m.role === 'system');
        const chatMessages = messages.filter((m) => m.role !== 'system');

        const body: Record<string, any> = {
            model: options?.model || 'claude-haiku-4-5-20251001',
            max_tokens: options?.max_tokens || 4096,
            temperature: options?.temperature ?? 0.7,
            system: systemMessage
                ? [
                      {
                          type: 'text',
                          text: typeof systemMessage.content === 'string'
                              ? systemMessage.content
                              : systemMessage.content[0]?.text,
                          ...(systemMessage.cache_control && { cache_control: systemMessage.cache_control }),
                      },
                  ]
                : options?.system,
            messages: chatMessages.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string'
                    ? m.content
                    : m.content.map((part) => ({
                          type: part.type,
                          ...(part.text && { text: part.text }),
                          ...(part.image_url && {
                              source: {
                                  type: 'url',
                                  url: part.image_url.url
                              }
                          }),
                      })),
                ...(m.cache_control && { cache_control: m.cache_control }),
            })),
        };

        // Добавляем web search если включен
        if (options?.web_search) {
            body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
        }

        const betaFeatures = ['prompt-caching-2024-07-31'];
        if (options?.web_search) {
            betaFeatures.push('web-search-2025-03-05');
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': config.API_KEY as string,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': betaFeatures.join(','),
        };

        const proxyAgent = await this.getProxyAgent();

        return firstValueFrom(
            this.httpService
                .post(`${this.baseUrl}/v1/messages`, body, {
                    headers,
                    ...(proxyAgent && { httpsAgent: proxyAgent, proxy: false }),
                })
                .pipe(map((res) => this.mapResponse(res.data)))
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(
                            `Anthropic API Error: ${error.message} ${JSON.stringify(error.response?.data)}`,
                        );
                        throw error;
                    }),
                ),
        );
    }

    async *chatStream(messages: AIChatMessage[], options?: AIChatOptions): AsyncIterable<AIStreamChunk> {
        const config = await this.vaultService.get('ai/anthropic');

        const systemMessage = messages.find((m) => m.role === 'system');
        const chatMessages = messages.filter((m) => m.role !== 'system');

        const body = {
            model: options?.model || 'claude-haiku-4-5-20251001',
            max_tokens: options?.max_tokens || 4096,
            temperature: options?.temperature ?? 0.7,
            stream: true,
            system: systemMessage
                ? typeof systemMessage.content === 'string'
                    ? systemMessage.content
                    : systemMessage.content[0]?.text
                : options?.system,
            messages: chatMessages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        };

        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': config.API_KEY as string,
            'anthropic-version': '2023-06-01',
        };

        const response = await fetch(`${this.baseUrl}/v1/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Anthropic stream error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        yield { content: '', done: true };
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.type === 'content_block_delta') {
                            yield {
                                content: parsed.delta?.text || '',
                                done: false,
                            };
                        } else if (parsed.type === 'message_stop') {
                            yield { content: '', done: true };
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        }
    }

    getModels(): AIModelInfo[] {
        return [
            {
                id: 'claude-haiku-4-5-20251001',
                name: 'Claude 4.5 Haiku',
                provider: AIProviderName.ANTHROPIC,
                maxTokens: 64000,
                inputCostPer1M: 1,
                outputCostPer1M: 5,
            },
            {
                id: 'claude-sonnet-4-5-20250929',
                name: 'Claude 4.5 Sonnet',
                provider: AIProviderName.ANTHROPIC,
                maxTokens: 64000,
                inputCostPer1M: 3,
                outputCostPer1M: 15,
            },
        ];
    }

    supportsFeature(feature: AIFeature): boolean {
        const supported = [AIFeature.STREAMING, AIFeature.PROMPT_CACHING, AIFeature.VISION];
        return supported.includes(feature);
    }

    estimateCost(inputTokens: number, outputTokens: number, model = 'claude-haiku-4-5-20251001'): number {
        const prices: Record<string, { input: number; output: number }> = {
            'claude-haiku-4-5-20251001': { input: 1, output: 5 },
            'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
        };
        const p = prices[model] || prices['claude-haiku-4-5-20251001'];
        return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
    }

    private mapResponse(data: any): AIChatResponse {
        // Извлекаем текст из content - может быть text block или после tool_use
        let content = '';
        for (const block of data.content || []) {
            if (block.type === 'text') {
                content += block.text;
            }
        }

        return {
            content,
            model: data.model,
            usage: {
                input_tokens: data.usage.input_tokens,
                output_tokens: data.usage.output_tokens,
            },
            finish_reason: data.stop_reason,
            cache_creation_input_tokens: data.usage.cache_creation_input_tokens,
            cache_read_input_tokens: data.usage.cache_read_input_tokens,
        };
    }
}
