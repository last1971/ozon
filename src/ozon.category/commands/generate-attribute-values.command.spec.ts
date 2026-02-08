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
});
