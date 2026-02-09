import { Test, TestingModule } from '@nestjs/testing';
import { AIService } from './ai.service';
import { AIProviderName, AIFeature } from './interfaces';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { YandexProvider } from './providers/yandex.provider';

describe('AIService', () => {
    let service: AIService;

    const mockAnthropicProvider = {
        name: AIProviderName.ANTHROPIC,
        chat: jest.fn().mockResolvedValue({
            content: 'Anthropic response',
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 100, output_tokens: 50 },
            finish_reason: 'end_turn',
        }),
        chatStream: jest.fn(),
        getModels: jest.fn().mockReturnValue([
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: AIProviderName.ANTHROPIC },
        ]),
        supportsFeature: jest.fn().mockImplementation((feature) =>
            [AIFeature.STREAMING, AIFeature.PROMPT_CACHING].includes(feature),
        ),
        estimateCost: jest.fn().mockReturnValue(0.00045),
    };

    const mockOpenAIProvider = {
        name: AIProviderName.OPENAI,
        chat: jest.fn().mockResolvedValue({
            content: 'OpenAI response',
            model: 'gpt-4o',
            usage: { input_tokens: 80, output_tokens: 40 },
            finish_reason: 'stop',
        }),
        chatStream: jest.fn(),
        getModels: jest.fn().mockReturnValue([
            { id: 'gpt-4o', name: 'GPT-4o', provider: AIProviderName.OPENAI },
        ]),
        supportsFeature: jest.fn().mockImplementation((feature) =>
            [AIFeature.STREAMING, AIFeature.VISION].includes(feature),
        ),
        estimateCost: jest.fn().mockReturnValue(0.0006),
    };

    const mockYandexProvider = {
        name: AIProviderName.YANDEX,
        chat: jest.fn().mockResolvedValue({
            content: 'Yandex response',
            model: 'yandexgpt/latest',
            usage: { input_tokens: 60, output_tokens: 30 },
            finish_reason: 'stop',
        }),
        chatStream: jest.fn(),
        getModels: jest.fn().mockReturnValue([
            { id: 'yandexgpt/latest', name: 'YandexGPT Pro', provider: AIProviderName.YANDEX },
        ]),
        supportsFeature: jest.fn().mockReturnValue(false),
        estimateCost: jest.fn().mockReturnValue(0.0216),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AIService,
                { provide: AnthropicProvider, useValue: mockAnthropicProvider },
                { provide: OpenAIProvider, useValue: mockOpenAIProvider },
                { provide: YandexProvider, useValue: mockYandexProvider },
            ],
        }).compile();

        service = module.get<AIService>(AIService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('chat', () => {
        it('should call Anthropic provider', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const result = await service.chat(AIProviderName.ANTHROPIC, messages);

            expect(mockAnthropicProvider.chat).toHaveBeenCalledWith(messages, undefined);
            expect(result.content).toBe('Anthropic response');
            expect(result.model).toBe('claude-sonnet-4-20250514');
        });

        it('should call OpenAI provider', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const result = await service.chat(AIProviderName.OPENAI, messages);

            expect(mockOpenAIProvider.chat).toHaveBeenCalledWith(messages, undefined);
            expect(result.content).toBe('OpenAI response');
        });

        it('should call Yandex provider', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const result = await service.chat(AIProviderName.YANDEX, messages);

            expect(mockYandexProvider.chat).toHaveBeenCalledWith(messages, undefined);
            expect(result.content).toBe('Yandex response');
        });

        it('should pass options to provider', async () => {
            const messages = [{ role: 'user' as const, content: 'Hello' }];
            const options = { model: 'claude-3-5-haiku-20241022', temperature: 0.5 };

            await service.chat(AIProviderName.ANTHROPIC, messages, options);

            expect(mockAnthropicProvider.chat).toHaveBeenCalledWith(messages, options);
        });
    });

    describe('getModels', () => {
        it('should return models for specific provider', () => {
            const models = service.getModels(AIProviderName.ANTHROPIC);

            expect(mockAnthropicProvider.getModels).toHaveBeenCalled();
            expect(models).toHaveLength(1);
            expect(models[0].id).toBe('claude-sonnet-4-20250514');
        });

        it('should return all models when no provider specified', () => {
            const models = service.getModels();

            expect(mockAnthropicProvider.getModels).toHaveBeenCalled();
            expect(mockOpenAIProvider.getModels).toHaveBeenCalled();
            expect(mockYandexProvider.getModels).toHaveBeenCalled();
            expect(models).toHaveLength(3);
        });
    });

    describe('supportsFeature', () => {
        it('should check feature support for Anthropic', () => {
            expect(service.supportsFeature(AIProviderName.ANTHROPIC, AIFeature.PROMPT_CACHING)).toBe(true);
            expect(service.supportsFeature(AIProviderName.ANTHROPIC, AIFeature.FUNCTION_CALLING)).toBe(false);
        });

        it('should check feature support for OpenAI', () => {
            expect(service.supportsFeature(AIProviderName.OPENAI, AIFeature.VISION)).toBe(true);
            expect(service.supportsFeature(AIProviderName.OPENAI, AIFeature.PROMPT_CACHING)).toBe(false);
        });
    });

    describe('estimateCost', () => {
        it('should estimate cost for Anthropic', () => {
            const cost = service.estimateCost(AIProviderName.ANTHROPIC, 1000, 500);

            expect(mockAnthropicProvider.estimateCost).toHaveBeenCalledWith(1000, 500, undefined);
            expect(cost).toBe(0.00045);
        });

        it('should estimate cost with model specified', () => {
            service.estimateCost(AIProviderName.OPENAI, 1000, 500, 'gpt-4o-mini');

            expect(mockOpenAIProvider.estimateCost).toHaveBeenCalledWith(1000, 500, 'gpt-4o-mini');
        });
    });
});
