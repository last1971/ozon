import { Test, TestingModule } from '@nestjs/testing';
import { AIProductService } from './ai.product.service';
import { AIService } from '../ai/ai.service';
import { AIProviderName } from '../ai/interfaces';

describe('AIProductService', () => {
    let service: AIProductService;

    const mockAIService = {
        chat: jest.fn(),
        estimateCost: jest.fn().mockReturnValue(0.001),
    };

    beforeEach(async () => {
        mockAIService.chat.mockResolvedValue({
            content: 'Samsung Телевизор LED 55 дюймов, 4K UHD (АРТ-12345)',
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 200, output_tokens: 30 },
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AIProductService,
                { provide: AIService, useValue: mockAIService },
            ],
        }).compile();

        service = module.get<AIProductService>(AIProductService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('generateName', () => {
        it('should generate product name', async () => {
            const result = await service.generateName('TDA7851L ( JSMICRO, JSMSEMI )');

            expect(result.name).toBeDefined();
            expect(result.tokens_used).toBe(230);
            expect(result.cost).toBe(0.001);
        });

        it('should call AI service with correct messages', async () => {
            await service.generateName('Конфорка D- 230 /2400w/230v EP-083 (стеклокерамика)');

            expect(mockAIService.chat).toHaveBeenCalledWith(
                AIProviderName.ANTHROPIC,
                expect.arrayContaining([
                    expect.objectContaining({
                        role: 'system',
                        cache_control: { type: 'ephemeral' },
                    }),
                    expect.objectContaining({ role: 'user' }),
                ]),
                expect.objectContaining({
                    max_tokens: 256,
                    temperature: 0.3,
                }),
            );
        });

        it('should use specified provider', async () => {
            await service.generateName('Магнетрон 2M246-21TAG', AIProviderName.OPENAI);

            expect(mockAIService.chat).toHaveBeenCalledWith(
                AIProviderName.OPENAI,
                expect.any(Array),
                expect.any(Object),
            );
        });
    });

    describe('generateAttributes', () => {
        beforeEach(() => {
            mockAIService.chat.mockResolvedValue({
                content: '[{"id": 123, "complex_id": 0, "values": [{"value": "Samsung"}]}]',
                model: 'claude-sonnet-4-20250514',
                usage: { input_tokens: 500, output_tokens: 100 },
            });
        });

        it('should generate attributes', async () => {
            const result = await service.generateAttributes({
                type_id: 12345,
                product_data: { name: 'Телевизор Samsung', brand: 'Samsung' },
                required_attributes: [
                    { id: 123, name: 'Бренд', type: 'string' },
                ],
            });

            expect(result.attributes).toHaveLength(1);
            expect(result.attributes[0].id).toBe(123);
            expect(result.attributes[0].values[0].value).toBe('Samsung');
            expect(result.tokens_used).toBe(600);
        });

        it('should handle invalid JSON response gracefully', async () => {
            mockAIService.chat.mockResolvedValue({
                content: 'This is not valid JSON',
                model: 'claude-sonnet-4-20250514',
                usage: { input_tokens: 500, output_tokens: 100 },
            });

            const result = await service.generateAttributes({
                type_id: 12345,
                product_data: { name: 'Test Product' },
            });

            expect(result.attributes).toEqual([]);
            expect(result.tokens_used).toBe(600);
        });

        it('should extract JSON from text with surrounding content', async () => {
            mockAIService.chat.mockResolvedValue({
                content: 'Here are the attributes:\n[{"id": 456, "complex_id": 0, "values": [{"value": "test"}]}]\nDone!',
                model: 'claude-sonnet-4-20250514',
                usage: { input_tokens: 500, output_tokens: 100 },
            });

            const result = await service.generateAttributes({
                type_id: 12345,
                product_data: { name: 'Test Product' },
            });

            expect(result.attributes).toHaveLength(1);
            expect(result.attributes[0].id).toBe(456);
        });

        it('should call AI service with system prompt cached', async () => {
            await service.generateAttributes({
                type_id: 12345,
                product_data: { name: 'Test' },
            });

            expect(mockAIService.chat).toHaveBeenCalledWith(
                AIProviderName.ANTHROPIC,
                expect.arrayContaining([
                    expect.objectContaining({
                        role: 'system',
                        cache_control: { type: 'ephemeral' },
                    }),
                ]),
                expect.objectContaining({
                    max_tokens: 2048,
                    temperature: 0.2,
                }),
            );
        });
    });
});
