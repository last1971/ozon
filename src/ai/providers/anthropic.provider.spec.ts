import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of, throwError } from 'rxjs';
import { AnthropicProvider } from './anthropic.provider';
import { AIProviderName, AIFeature } from '../interfaces';

describe('AnthropicProvider', () => {
    let provider: AnthropicProvider;

    const mockVaultService = {
        get: jest.fn(),
    };

    const mockHttpService = {
        post: jest.fn(),
    };

    beforeEach(async () => {
        mockVaultService.get.mockImplementation((path: string) => {
            if (path === 'ai/anthropic') {
                return Promise.resolve({ API_KEY: 'test-api-key' });
            }
            if (path === 'ai/proxy') {
                return Promise.resolve({ URL: 'http://proxy:8080' });
            }
            return Promise.reject(new Error('Unknown path'));
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AnthropicProvider,
                { provide: HttpService, useValue: mockHttpService },
                { provide: VaultService, useValue: mockVaultService },
            ],
        }).compile();

        provider = module.get<AnthropicProvider>(AnthropicProvider);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(provider).toBeDefined();
        expect(provider.name).toBe(AIProviderName.ANTHROPIC);
    });

    describe('chat', () => {
        const mockApiResponse = {
            data: {
                content: [{ type: 'text', text: 'Hello from Claude' }],
                model: 'claude-haiku-4-5-20251001',
                usage: {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
                stop_reason: 'end_turn',
            },
        };

        beforeEach(() => {
            mockHttpService.post.mockReturnValue(of(mockApiResponse));
        });

        it('should send chat request to Anthropic API', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const result = await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    model: 'claude-haiku-4-5-20251001',
                    messages: [{ role: 'user', content: 'Hello' }],
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'x-api-key': 'test-api-key',
                        'anthropic-version': '2023-06-01',
                    }),
                }),
            );

            expect(result.content).toBe('Hello from Claude');
            expect(result.model).toBe('claude-haiku-4-5-20251001');
            expect(result.usage.input_tokens).toBe(100);
            expect(result.usage.output_tokens).toBe(50);
        });

        it('should handle system message with cache_control', async () => {
            const messages = [
                {
                    role: 'system' as const,
                    content: 'You are helpful',
                    cache_control: { type: 'ephemeral' as const },
                },
                { role: 'user' as const, content: 'Hello' },
            ];

            await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    system: [
                        expect.objectContaining({
                            type: 'text',
                            text: 'You are helpful',
                            cache_control: { type: 'ephemeral' },
                        }),
                    ],
                    messages: [{ role: 'user', content: 'Hello' }],
                }),
                expect.any(Object),
            );
        });

        it('should add web search tools when enabled', async () => {
            const messages = [{ role: 'user' as const, content: 'Search for something' }];

            await provider.chat(messages, { web_search: true });

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'anthropic-beta': 'prompt-caching-2024-07-31,web-search-2025-03-05',
                    }),
                }),
            );
        });

        it('should use custom model and options', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const options = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 1024,
                temperature: 0.5,
            };

            await provider.chat(messages, options);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    model: 'claude-sonnet-4-5-20250929',
                    max_tokens: 1024,
                    temperature: 0.5,
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

            const messages = [{ role: 'user' as const, content: 'Hello' }];

            await expect(provider.chat(messages)).rejects.toMatchObject({
                message: 'API Error',
            });
        });
    });

    describe('getModels', () => {
        it('should return available models', () => {
            const models = provider.getModels();

            expect(models).toHaveLength(2);
            expect(models[0].id).toBe('claude-haiku-4-5-20251001');
            expect(models[1].id).toBe('claude-sonnet-4-5-20250929');
            expect(models.every((m) => m.provider === AIProviderName.ANTHROPIC)).toBe(true);
        });
    });

    describe('supportsFeature', () => {
        it('should return true for supported features', () => {
            expect(provider.supportsFeature(AIFeature.STREAMING)).toBe(true);
            expect(provider.supportsFeature(AIFeature.PROMPT_CACHING)).toBe(true);
            expect(provider.supportsFeature(AIFeature.VISION)).toBe(true);
        });

        it('should return false for unsupported features', () => {
            expect(provider.supportsFeature(AIFeature.FUNCTION_CALLING)).toBe(false);
        });
    });

    describe('estimateCost', () => {
        it('should estimate cost for haiku model', () => {
            const cost = provider.estimateCost(1000, 500, 'claude-haiku-4-5-20251001');
            // (1000 * 1 + 500 * 5) / 1_000_000 = 0.0035
            expect(cost).toBe(0.0035);
        });

        it('should estimate cost for sonnet model', () => {
            const cost = provider.estimateCost(1000, 500, 'claude-sonnet-4-5-20250929');
            // (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
            expect(cost).toBe(0.0105);
        });

        it('should use haiku pricing for unknown models', () => {
            const cost = provider.estimateCost(1000, 500, 'unknown-model');
            expect(cost).toBe(0.0035);
        });
    });
});
