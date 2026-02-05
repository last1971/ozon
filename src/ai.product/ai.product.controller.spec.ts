import { Test, TestingModule } from '@nestjs/testing';
import { AIProductController } from './ai.product.controller';
import { AIProductService } from './ai.product.service';
import { AIProviderName } from '../ai/interfaces';

describe('AIProductController', () => {
    let controller: AIProductController;

    const mockAIProductService = {
        generateName: jest.fn(),
    };

    beforeEach(async () => {
        mockAIProductService.generateName.mockResolvedValue({
            name: 'Микросхема усилитель TDA7851L (JSMICRO)',
            tokens_used: 230,
            cost: 0.001,
        });

        const module: TestingModule = await Test.createTestingModule({
            controllers: [AIProductController],
            providers: [{ provide: AIProductService, useValue: mockAIProductService }],
        }).compile();

        controller = module.get<AIProductController>(AIProductController);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('generateName', () => {
        it('should generate product name with default provider', async () => {
            const body = { text: 'TDA7851L ( JSMICRO, JSMSEMI )' };

            const result = await controller.generateName(body);

            expect(mockAIProductService.generateName).toHaveBeenCalledWith(
                'TDA7851L ( JSMICRO, JSMSEMI )',
                AIProviderName.ANTHROPIC,
                undefined,
            );
            expect(result.name).toBe('Микросхема усилитель TDA7851L (JSMICRO)');
            expect(result.tokens_used).toBe(230);
            expect(result.cost).toBe(0.001);
        });

        it('should use specified provider', async () => {
            const body = {
                text: 'Магнетрон 2M246-21TAG',
                provider: AIProviderName.OPENAI,
            };

            await controller.generateName(body);

            expect(mockAIProductService.generateName).toHaveBeenCalledWith(
                'Магнетрон 2M246-21TAG',
                AIProviderName.OPENAI,
                undefined,
            );
        });

        it('should use specified model', async () => {
            const body = {
                text: 'Конфорка D- 230',
                provider: AIProviderName.ANTHROPIC,
                model: 'claude-sonnet-4-5-20250929',
            };

            await controller.generateName(body);

            expect(mockAIProductService.generateName).toHaveBeenCalledWith(
                'Конфорка D- 230',
                AIProviderName.ANTHROPIC,
                'claude-sonnet-4-5-20250929',
            );
        });

        it('should handle service errors', async () => {
            mockAIProductService.generateName.mockRejectedValue(new Error('Service error'));

            const body = { text: 'test' };

            await expect(controller.generateName(body)).rejects.toThrow('Service error');
        });
    });
});
