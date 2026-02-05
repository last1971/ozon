import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of, throwError } from 'rxjs';
import { YandexProvider } from './yandex.provider';
import { AIProviderName, AIFeature } from '../interfaces';

describe('YandexProvider', () => {
    let provider: YandexProvider;

    const mockVaultService = {
        get: jest.fn(),
    };

    const mockHttpService = {
        post: jest.fn(),
    };

    beforeEach(async () => {
        mockVaultService.get.mockImplementation((path: string) => {
            if (path === 'ai/yandex') {
                return Promise.resolve({
                    API_KEY: 'test-api-key',
                    FOLDER_ID: 'test-folder-id',
                });
            }
            return Promise.reject(new Error('Unknown path'));
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                YandexProvider,
                { provide: HttpService, useValue: mockHttpService },
                { provide: VaultService, useValue: mockVaultService },
            ],
        }).compile();

        provider = module.get<YandexProvider>(YandexProvider);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(provider).toBeDefined();
        expect(provider.name).toBe(AIProviderName.YANDEX);
    });

    describe('chat', () => {
        const mockApiResponse = {
            data: {
                result: {
                    alternatives: [
                        {
                            message: { text: 'Привет от YandexGPT' },
                            status: 'ALTERNATIVE_STATUS_FINAL',
                        },
                    ],
                    modelVersion: 'yandexgpt-lite/latest',
                    usage: {
                        inputTextTokens: '100',
                        completionTokens: '50',
                    },
                },
            },
        };

        beforeEach(() => {
            mockHttpService.post.mockReturnValue(of(mockApiResponse));
        });

        it('should send chat request to Yandex API', async () => {
            const messages = [{ role: 'user' as const, content: 'Привет' }];
            const result = await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
                expect.objectContaining({
                    modelUri: 'gpt://test-folder-id/yandexgpt-lite/latest',
                    messages: [{ role: 'user', text: 'Привет' }],
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Api-Key test-api-key',
                        'x-folder-id': 'test-folder-id',
                    }),
                }),
            );

            expect(result.content).toBe('Привет от YandexGPT');
            expect(result.model).toBe('yandexgpt-lite/latest');
            expect(result.usage.input_tokens).toBe(100);
            expect(result.usage.output_tokens).toBe(50);
        });

        it('should handle system message', async () => {
            const messages = [
                { role: 'system' as const, content: 'Ты полезный ассистент' },
                { role: 'user' as const, content: 'Привет' },
            ];

            await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    messages: [
                        { role: 'system', text: 'Ты полезный ассистент' },
                        { role: 'user', text: 'Привет' },
                    ],
                }),
                expect.any(Object),
            );
        });

        it('should use custom model and options', async () => {
            const messages = [{ role: 'user' as const, content: 'Привет' }];
            const options = {
                model: 'yandexgpt/latest',
                max_tokens: 1024,
                temperature: 0.5,
            };

            await provider.chat(messages, options);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    modelUri: 'gpt://test-folder-id/yandexgpt/latest',
                    completionOptions: expect.objectContaining({
                        maxTokens: 1024,
                        temperature: 0.5,
                    }),
                }),
                expect.any(Object),
            );
        });

        it('should handle API errors', async () => {
            mockHttpService.post.mockReturnValue(
                throwError(() => ({
                    message: 'API Error',
                    response: { data: { error: 'Invalid API key' } },
                })),
            );

            const messages = [{ role: 'user' as const, content: 'Привет' }];

            await expect(provider.chat(messages)).rejects.toMatchObject({
                message: 'API Error',
            });
        });
    });

    describe('getModels', () => {
        it('should return available models', () => {
            const models = provider.getModels();

            expect(models).toHaveLength(2);
            expect(models.map((m) => m.id)).toContain('yandexgpt-lite/latest');
            expect(models.map((m) => m.id)).toContain('yandexgpt/latest');
            expect(models.every((m) => m.provider === AIProviderName.YANDEX)).toBe(true);
        });
    });

    describe('supportsFeature', () => {
        it('should return true for streaming', () => {
            expect(provider.supportsFeature(AIFeature.STREAMING)).toBe(true);
        });

        it('should return false for other features', () => {
            expect(provider.supportsFeature(AIFeature.VISION)).toBe(false);
            expect(provider.supportsFeature(AIFeature.FUNCTION_CALLING)).toBe(false);
            expect(provider.supportsFeature(AIFeature.PROMPT_CACHING)).toBe(false);
        });
    });

    describe('estimateCost', () => {
        it('should estimate cost for yandexgpt-lite model (in rubles)', () => {
            const cost = provider.estimateCost(1000, 500, 'yandexgpt-lite/latest');
            // (1000 + 500) * 0.12 / 1000 = 0.18
            expect(cost).toBe(0.18);
        });

        it('should estimate cost for yandexgpt model (in rubles)', () => {
            const cost = provider.estimateCost(1000, 500, 'yandexgpt/latest');
            // (1000 + 500) * 0.24 / 1000 = 0.36
            expect(cost).toBe(0.36);
        });

        it('should use yandexgpt-lite pricing for unknown models', () => {
            const cost = provider.estimateCost(1000, 500, 'unknown-model');
            expect(cost).toBe(0.18);
        });
    });
});
