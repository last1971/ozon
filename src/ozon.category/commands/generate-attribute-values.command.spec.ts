import { GenerateAttributeValuesCommand } from './generate-attribute-values.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';

describe('GenerateAttributeValuesCommand', () => {
    const makeAiService = (content: string) => ({
        chat: jest.fn().mockResolvedValue({
            content,
            usage: { input_tokens: 1000, output_tokens: 200 },
            model: 'claude-haiku-4-5-20251001',
        }),
        estimateCost: jest.fn().mockReturnValue(0.005),
    });

    it('should parse description, hashtags, and attributes from AI response', async () => {
        const json = JSON.stringify({
            description: 'Описание товара',
            hashtags: 'тест, товар',
            attributes: [{ id: 85, value: 'Brand', dictionary_value_id: 123 }],
        });
        const aiService = makeAiService(json) as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: { text: 'test', provider: undefined } as any as CreateProductInput,
            generated_name: 'Test Product',
            required_attributes: [],
        };

        const result = await command.execute(context);

        expect(result.description).toBe('Описание товара');
        expect(result.hashtags).toBe('тест, товар');
        expect(result.ai_attributes).toHaveLength(1);
        expect(result.ai_attributes![0].id).toBe(85);
        expect(result.ai_cost).toEqual({ tokens: 1200, cost: 0.005 });
    });

    it('should convert numeric attribute values to strings', async () => {
        const json = JSON.stringify({
            description: 'Блок питания',
            hashtags: 'блок',
            attributes: [
                { id: 8513, value: 1 },
                { id: 6157, value: 2 },
                { id: 85, value: 'Samsung' },
            ],
        });
        const aiService = makeAiService(json) as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: { text: 'test', provider: undefined } as any as CreateProductInput,
            generated_name: 'Test Product',
            required_attributes: [],
        };

        const result = await command.execute(context);

        expect(result.ai_attributes).toHaveLength(3);
        expect(result.ai_attributes![0].value).toBe('1');
        expect(result.ai_attributes![1].value).toBe('2');
        expect(result.ai_attributes![2].value).toBe('Samsung');
        expect(typeof result.ai_attributes![0].value).toBe('string');
        expect(typeof result.ai_attributes![1].value).toBe('string');
    });

    it('should handle invalid JSON from AI gracefully', async () => {
        const aiService = makeAiService('not a json') as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: { text: 'test' } as CreateProductInput,
            required_attributes: [],
        };

        const result = await command.execute(context);

        expect(result.description).toBeUndefined();
        expect(result.ai_attributes).toBeUndefined();
        expect(result.ai_cost).toEqual({ tokens: 1200, cost: 0.005 });
    });

    it('should call chat with web_search enabled', async () => {
        const aiService = makeAiService('{}') as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: { text: 'test' } as CreateProductInput,
            required_attributes: [],
        };

        await command.execute(context);

        expect(aiService.chat).toHaveBeenCalledTimes(1);
        const callArgs = aiService.chat.mock.calls[0];
        expect(callArgs[2].web_search).toBe(true);
        expect(callArgs[2].temperature).toBe(0.2);
    });

    it('should fill missing dimensions from AI response', async () => {
        const json = JSON.stringify({
            description: 'Блок питания',
            hashtags: 'блок, питание',
            attributes: [],
            dimensions: { depth: 100, width: 80, height: 40, weight: 350, weight_with_packaging: 400 },
        });
        const aiService = makeAiService(json) as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: {
                text: 'NDR-75-12',
                package_depth: 0, package_width: 0, package_height: 0,
                weight_without_packaging: 0, weight_with_packaging: 0,
            } as any as CreateProductInput,
            required_attributes: [],
        };

        await command.execute(context);

        expect(context.input.package_depth).toBe(100);
        expect(context.input.package_width).toBe(80);
        expect(context.input.package_height).toBe(40);
        expect(context.input.weight_without_packaging).toBe(350);
        expect(context.input.weight_with_packaging).toBe(400);
    });

    it('should NOT overwrite existing dimensions with AI values', async () => {
        const json = JSON.stringify({
            description: 'Блок питания',
            hashtags: 'блок, питание',
            attributes: [],
            dimensions: { depth: 999, width: 999, height: 999, weight: 999, weight_with_packaging: 999 },
        });
        const aiService = makeAiService(json) as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: {
                text: 'NDR-75-12',
                package_depth: 100, package_width: 80, package_height: 40,
                weight_without_packaging: 350, weight_with_packaging: 400,
            } as any as CreateProductInput,
            required_attributes: [],
        };

        await command.execute(context);

        expect(context.input.package_depth).toBe(100);
        expect(context.input.package_width).toBe(80);
        expect(context.input.package_height).toBe(40);
        expect(context.input.weight_without_packaging).toBe(350);
        expect(context.input.weight_with_packaging).toBe(400);
    });

    it('should fill only missing fields, keep existing ones', async () => {
        const json = JSON.stringify({
            description: 'test',
            hashtags: '',
            attributes: [],
            dimensions: { depth: 200, width: 150, height: 60, weight: 500, weight_with_packaging: 550 },
        });
        const aiService = makeAiService(json) as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: {
                text: 'test',
                package_depth: 100, package_width: 0, package_height: 40,
                weight_without_packaging: 0, weight_with_packaging: 400,
            } as any as CreateProductInput,
            required_attributes: [],
        };

        await command.execute(context);

        // Existing values preserved
        expect(context.input.package_depth).toBe(100);
        expect(context.input.package_height).toBe(40);
        expect(context.input.weight_with_packaging).toBe(400);
        // Missing values filled from AI
        expect(context.input.package_width).toBe(150);
        expect(context.input.weight_without_packaging).toBe(500);
    });

    it('should include dimension info in user prompt', async () => {
        const aiService = makeAiService('{}') as any;
        const command = new GenerateAttributeValuesCommand(aiService);
        const context: IProductCreateContext = {
            input: {
                text: 'test',
                package_depth: 0, package_width: 0, package_height: 0,
                weight_without_packaging: 0, weight_with_packaging: 0,
            } as any as CreateProductInput,
            required_attributes: [],
        };

        await command.execute(context);

        const userPrompt = aiService.chat.mock.calls[0][1][1].content;
        expect(userPrompt).toContain('НЕ ЗАДАНЫ');
        expect(userPrompt).toContain('глубина');
        expect(userPrompt).toContain('ОПРЕДЕЛИ через веб-поиск');
    });
});
