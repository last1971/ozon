import { GenerateNameCommand } from './generate-name.command';
import { IProductCreateContext, CreateProductInput } from '../interfaces/product-create.context';
import { AIProviderName } from '../../ai/interfaces';

describe('GenerateNameCommand', () => {
    it('should set generated_name and name_cost from AIProductService', async () => {
        const aiProductService = {
            generateName: jest.fn().mockResolvedValue({
                name: 'Блок питания NDR-75-12',
                tokens_used: 500,
                cost: 0.003,
            }),
        } as any;
        const command = new GenerateNameCommand(aiProductService);
        const context: IProductCreateContext = {
            input: { text: 'БП 75W 12V', provider: AIProviderName.ANTHROPIC } as CreateProductInput,
        };

        const result = await command.execute(context);

        expect(result.generated_name).toBe('Блок питания NDR-75-12');
        expect(result.name_cost).toEqual({ tokens: 500, cost: 0.003 });
        expect(aiProductService.generateName).toHaveBeenCalledWith('БП 75W 12V', AIProviderName.ANTHROPIC, undefined);
    });

    it('should default to ANTHROPIC provider', async () => {
        const aiProductService = {
            generateName: jest.fn().mockResolvedValue({ name: 'Test', tokens_used: 0, cost: 0 }),
        } as any;
        const command = new GenerateNameCommand(aiProductService);
        const context: IProductCreateContext = {
            input: { text: 'test' } as CreateProductInput,
        };

        await command.execute(context);
        expect(aiProductService.generateName).toHaveBeenCalledWith('test', AIProviderName.ANTHROPIC, undefined);
    });

    it('should handle zero tokens', async () => {
        const aiProductService = {
            generateName: jest.fn().mockResolvedValue({ name: 'Test', tokens_used: 0, cost: 0 }),
        } as any;
        const command = new GenerateNameCommand(aiProductService);
        const context: IProductCreateContext = { input: { text: 'x' } as CreateProductInput };

        const result = await command.execute(context);
        expect(result.name_cost).toEqual({ tokens: 0, cost: 0 });
    });
});
