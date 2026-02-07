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
export class OpenAIProvider implements AIProvider {
    readonly name = AIProviderName.OPENAI;
    private logger = new Logger(OpenAIProvider.name);
    private readonly baseUrl = 'https://api.openai.com';
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
        const config = await this.vaultService.get('ai/openai');

        const body = {
            model: options?.model || 'gpt-4o-mini',
            max_tokens: options?.max_tokens || 4096,
            temperature: options?.temperature ?? 0.7,
            messages: messages.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string'
                    ? m.content
                    : m.content.map((part) => ({
                          type: part.type === 'image' ? 'image_url' : 'text',
                          ...(part.text && { text: part.text }),
                          ...(part.image_url && { image_url: part.image_url }),
                      })),
            })),
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.API_KEY}`,
        };

        if (config.ORG_ID) {
            headers['OpenAI-Organization'] = config.ORG_ID as string;
        }

        const proxyAgent = await this.getProxyAgent();

        return firstValueFrom(
            this.httpService
                .post(`${this.baseUrl}/v1/chat/completions`, body, {
                    headers,
                    ...(proxyAgent && { httpsAgent: proxyAgent, proxy: false }),
                })
                .pipe(map((res) => this.mapResponse(res.data)))
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(
                            `OpenAI API Error: ${error.message} ${JSON.stringify(error.response?.data)}`,
                        );
                        throw error;
                    }),
                ),
        );
    }

    async *chatStream(messages: AIChatMessage[], options?: AIChatOptions): AsyncIterable<AIStreamChunk> {
        const config = await this.vaultService.get('ai/openai');

        const body = {
            model: options?.model || 'gpt-4o-mini',
            max_tokens: options?.max_tokens || 4096,
            temperature: options?.temperature ?? 0.7,
            stream: true,
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.API_KEY}`,
        };

        if (config.ORG_ID) {
            headers['OpenAI-Organization'] = config.ORG_ID as string;
        }

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`OpenAI stream error: ${response.status}`);
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
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta?.content) {
                            yield {
                                content: delta.content,
                                done: false,
                            };
                        }
                        if (parsed.choices?.[0]?.finish_reason) {
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
                id: 'gpt-4o-mini',
                name: 'GPT-4o Mini',
                provider: AIProviderName.OPENAI,
                maxTokens: 16384,
                inputCostPer1M: 0.15,
                outputCostPer1M: 0.6,
            },
            {
                id: 'gpt-4o',
                name: 'GPT-4o',
                provider: AIProviderName.OPENAI,
                maxTokens: 4096,
                inputCostPer1M: 2.5,
                outputCostPer1M: 10,
            },
            {
                id: 'gpt-4-turbo',
                name: 'GPT-4 Turbo',
                provider: AIProviderName.OPENAI,
                maxTokens: 4096,
                inputCostPer1M: 10,
                outputCostPer1M: 30,
            },
        ];
    }

    supportsFeature(feature: AIFeature): boolean {
        const supported = [AIFeature.STREAMING, AIFeature.VISION, AIFeature.FUNCTION_CALLING];
        return supported.includes(feature);
    }

    estimateCost(inputTokens: number, outputTokens: number, model = 'gpt-4o-mini'): number {
        const prices: Record<string, { input: number; output: number }> = {
            'gpt-4o-mini': { input: 0.15, output: 0.6 },
            'gpt-4o': { input: 2.5, output: 10 },
            'gpt-4-turbo': { input: 10, output: 30 },
        };
        const p = prices[model] || prices['gpt-4o-mini'];
        return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
    }

    private mapResponse(data: any): AIChatResponse {
        const choice = data.choices[0];
        return {
            content: choice.message.content || '',
            model: data.model,
            usage: {
                input_tokens: data.usage.prompt_tokens,
                output_tokens: data.usage.completion_tokens,
            },
            finish_reason: choice.finish_reason,
        };
    }

    /**
     * Генерирует embedding вектор для текста
     * @param text Текст для векторизации
     * @param model Модель (по умолчанию text-embedding-3-small, 1536 dimensions)
     * @returns Массив чисел (вектор)
     */
    async generateEmbedding(text: string, model = 'text-embedding-3-small'): Promise<number[]> {
        const config = await this.vaultService.get('ai/openai');

        const body = {
            model,
            input: text,
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.API_KEY}`,
        };

        if (config.ORG_ID) {
            headers['OpenAI-Organization'] = config.ORG_ID as string;
        }

        const proxyAgent = await this.getProxyAgent();

        const response = await firstValueFrom(
            this.httpService
                .post(`${this.baseUrl}/v1/embeddings`, body, {
                    headers,
                    ...(proxyAgent && { httpsAgent: proxyAgent, proxy: false }),
                })
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(
                            `OpenAI Embedding Error: ${error.message} ${JSON.stringify(error.response?.data)}`,
                        );
                        throw error;
                    }),
                ),
        );

        return response.data.data[0].embedding;
    }

    /**
     * Генерирует embeddings для нескольких текстов батчем
     * @param texts Массив текстов
     * @param model Модель
     * @returns Массив векторов
     */
    async generateEmbeddings(texts: string[], model = 'text-embedding-3-small'): Promise<number[][]> {
        const config = await this.vaultService.get('ai/openai');

        const body = {
            model,
            input: texts,
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.API_KEY}`,
        };

        if (config.ORG_ID) {
            headers['OpenAI-Organization'] = config.ORG_ID as string;
        }

        const proxyAgent = await this.getProxyAgent();

        const response = await firstValueFrom(
            this.httpService
                .post(`${this.baseUrl}/v1/embeddings`, body, {
                    headers,
                    ...(proxyAgent && { httpsAgent: proxyAgent, proxy: false }),
                })
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(
                            `OpenAI Embeddings Error: ${error.message} ${JSON.stringify(error.response?.data)}`,
                        );
                        throw error;
                    }),
                ),
        );

        // Сортируем по index чтобы порядок соответствовал входным текстам
        return response.data.data
            .sort((a: any, b: any) => a.index - b.index)
            .map((item: any) => item.embedding);
    }
}
