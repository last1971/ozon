import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
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
export class YandexProvider implements AIProvider {
    readonly name = AIProviderName.YANDEX;
    private logger = new Logger(YandexProvider.name);
    private readonly baseUrl = 'https://llm.api.cloud.yandex.net';

    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {}

    async chat(messages: AIChatMessage[], options?: AIChatOptions): Promise<AIChatResponse> {
        const config = await this.vaultService.get('ai/yandex');

        const body = {
            modelUri: `gpt://${config.FOLDER_ID}/${options?.model || 'yandexgpt-lite/latest'}`,
            completionOptions: {
                maxTokens: options?.max_tokens || 2000,
                temperature: options?.temperature ?? 0.6,
            },
            messages: messages.map((m) => ({
                role: m.role,
                text: typeof m.content === 'string' ? m.content : m.content[0]?.text,
            })),
        };

        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Api-Key ${config.API_KEY}`,
            'x-folder-id': config.FOLDER_ID as string,
        };

        return firstValueFrom(
            this.httpService
                .post(`${this.baseUrl}/foundationModels/v1/completion`, body, { headers })
                .pipe(map((res) => this.mapResponse(res.data)))
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(
                            `Yandex API Error: ${error.message} ${JSON.stringify(error.response?.data)}`,
                        );
                        throw error;
                    }),
                ),
        );
    }

    async *chatStream(messages: AIChatMessage[], options?: AIChatOptions): AsyncIterable<AIStreamChunk> {
        const config = await this.vaultService.get('ai/yandex');

        const body = {
            modelUri: `gpt://${config.FOLDER_ID}/${options?.model || 'yandexgpt-lite/latest'}`,
            completionOptions: {
                maxTokens: options?.max_tokens || 2000,
                temperature: options?.temperature ?? 0.6,
                stream: true,
            },
            messages: messages.map((m) => ({
                role: m.role,
                text: typeof m.content === 'string' ? m.content : m.content[0]?.text,
            })),
        };

        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Api-Key ${config.API_KEY}`,
            'x-folder-id': config.FOLDER_ID as string,
        };

        const response = await fetch(`${this.baseUrl}/foundationModels/v1/completion`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Yandex stream error: ${response.status}`);
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
                if (line.trim()) {
                    try {
                        const parsed = JSON.parse(line);
                        const alternative = parsed.result?.alternatives?.[0];
                        if (alternative?.message?.text) {
                            yield {
                                content: alternative.message.text,
                                done: alternative.status === 'ALTERNATIVE_STATUS_FINAL',
                            };
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
                id: 'yandexgpt-lite/latest',
                name: 'YandexGPT Lite',
                provider: AIProviderName.YANDEX,
                maxTokens: 8192,
                inputCostPer1M: 120,  // руб
                outputCostPer1M: 120,
            },
            {
                id: 'yandexgpt/latest',
                name: 'YandexGPT Pro',
                provider: AIProviderName.YANDEX,
                maxTokens: 8192,
                inputCostPer1M: 240,
                outputCostPer1M: 240,
            },
        ];
    }

    supportsFeature(feature: AIFeature): boolean {
        return feature === AIFeature.STREAMING;
    }

    estimateCost(inputTokens: number, outputTokens: number, model = 'yandexgpt-lite/latest'): number {
        // Цены Yandex в рублях за 1000 токенов
        const prices: Record<string, { input: number; output: number }> = {
            'yandexgpt-lite/latest': { input: 0.12, output: 0.12 },
            'yandexgpt/latest': { input: 0.24, output: 0.24 },
        };
        const p = prices[model] || prices['yandexgpt-lite/latest'];
        return ((inputTokens + outputTokens) * p.input) / 1000;
    }

    private mapResponse(data: any): AIChatResponse {
        const result = data.result;
        return {
            content: result.alternatives[0]?.message?.text || '',
            model: result.modelVersion,
            usage: {
                input_tokens: parseInt(result.usage.inputTextTokens, 10),
                output_tokens: parseInt(result.usage.completionTokens, 10),
            },
            finish_reason: result.alternatives[0]?.status || 'stop',
        };
    }
}
