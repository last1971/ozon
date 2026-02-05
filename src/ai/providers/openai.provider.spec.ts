import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of, throwError } from 'rxjs';
import { OpenAIProvider } from './openai.provider';
import { AIProviderName, AIFeature } from '../interfaces';

describe('OpenAIProvider', () => {
    let provider: OpenAIProvider;

    const mockVaultService = {
        get: jest.fn(),
    };

    const mockHttpService = {
        post: jest.fn(),
    };

    beforeEach(async () => {
        mockVaultService.get.mockImplementation((path: string) => {
            if (path === 'ai/openai') {
                return Promise.resolve({ API_KEY: 'test-api-key', ORG_ID: 'test-org' });
            }
            if (path === 'ai/proxy') {
                return Promise.resolve({ URL: 'http://proxy:8080' });
            }
            return Promise.reject(new Error('Unknown path'));
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OpenAIProvider,
                { provide: HttpService, useValue: mockHttpService },
                { provide: VaultService, useValue: mockVaultService },
            ],
        }).compile();

        provider = module.get<OpenAIProvider>(OpenAIProvider);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(provider).toBeDefined();
        expect(provider.name).toBe(AIProviderName.OPENAI);
    });

    describe('chat', () => {
        const mockApiResponse = {
            data: {
                choices: [
                    {
                        message: { content: 'Hello from GPT' },
                        finish_reason: 'stop',
                    },
                ],
                model: 'gpt-4o-mini',
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                },
            },
        };

        beforeEach(() => {
            mockHttpService.post.mockReturnValue(of(mockApiResponse));
        });

        it('should send chat request to OpenAI API', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const result = await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.stringContaining('/v1/chat/completions'),
                expect.objectContaining({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: 'Hello' }],
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer test-api-key',
                        'OpenAI-Organization': 'test-org',
                    }),
                }),
            );

            expect(result.content).toBe('Hello from GPT');
            expect(result.model).toBe('gpt-4o-mini');
            expect(result.usage.input_tokens).toBe(100);
            expect(result.usage.output_tokens).toBe(50);
        });

        it('should handle system message', async () => {
            const messages = [
                { role: 'system' as const, content: 'You are helpful' },
                { role: 'user' as const, content: 'Hello' },
            ];

            await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    messages: [
                        { role: 'system', content: 'You are helpful' },
                        { role: 'user', content: 'Hello' },
                    ],
                }),
                expect.any(Object),
            );
        });

        it('should use custom model and options', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const options = {
                model: 'gpt-4o',
                max_tokens: 1024,
                temperature: 0.5,
            };

            await provider.chat(messages, options);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    model: 'gpt-4o',
                    max_tokens: 1024,
                    temperature: 0.5,
                }),
                expect.any(Object),
            );
        });

        it('should work without ORG_ID', async () => {
            mockVaultService.get.mockImplementation((path: string) => {
                if (path === 'ai/openai') {
                    return Promise.resolve({ API_KEY: 'test-api-key' });
                }
                return Promise.reject(new Error('Unknown path'));
            });

            const messages = [{ role: 'user' as const, content: 'Hello' }];
            await provider.chat(messages);

            expect(mockHttpService.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                expect.objectContaining({
                    headers: expect.not.objectContaining({
                        'OpenAI-Organization': expect.anything(),
                    }),
                }),
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

            expect(models).toHaveLength(3);
            expect(models.map((m) => m.id)).toContain('gpt-4o-mini');
            expect(models.map((m) => m.id)).toContain('gpt-4o');
            expect(models.map((m) => m.id)).toContain('gpt-4-turbo');
            expect(models.every((m) => m.provider === AIProviderName.OPENAI)).toBe(true);
        });
    });

    describe('supportsFeature', () => {
        it('should return true for supported features', () => {
            expect(provider.supportsFeature(AIFeature.STREAMING)).toBe(true);
            expect(provider.supportsFeature(AIFeature.VISION)).toBe(true);
            expect(provider.supportsFeature(AIFeature.FUNCTION_CALLING)).toBe(true);
        });

        it('should return false for unsupported features', () => {
            expect(provider.supportsFeature(AIFeature.PROMPT_CACHING)).toBe(false);
        });
    });

    describe('estimateCost', () => {
        it('should estimate cost for gpt-4o-mini model', () => {
            const cost = provider.estimateCost(1000, 500, 'gpt-4o-mini');
            // (1000 * 0.15 + 500 * 0.6) / 1_000_000 = 0.00045
            expect(cost).toBe(0.00045);
        });

        it('should estimate cost for gpt-4o model', () => {
            const cost = provider.estimateCost(1000, 500, 'gpt-4o');
            // (1000 * 2.5 + 500 * 10) / 1_000_000 = 0.0075
            expect(cost).toBe(0.0075);
        });

        it('should use gpt-4o-mini pricing for unknown models', () => {
            const cost = provider.estimateCost(1000, 500, 'unknown-model');
            expect(cost).toBe(0.00045);
        });
    });
});
