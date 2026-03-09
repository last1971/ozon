import { GenerateWbCharcsCommand } from './generate-wb-charcs.command';
import { AIService } from '../../ai/ai.service';
import { IWbCreateCardContext, WbCharc } from '../interfaces/wb-create-card.interface';

describe('GenerateWbCharcsCommand', () => {
    let command: GenerateWbCharcsCommand;
    let chat: jest.Mock;

    const mockCharcs: WbCharc[] = [
        { charcID: 5023, name: 'Модель', required: false, unitName: '', maxCount: 1, popular: true, charcType: 1 },
        { charcID: 355421, name: 'Напряжение (В)', required: false, unitName: 'В', maxCount: 0, popular: false, charcType: 4 },
        { charcID: 15001405, name: 'Ставка НДС', required: false, unitName: '', maxCount: 1, popular: false, charcType: 1 },
    ];

    beforeEach(() => {
        chat = jest.fn();
        const aiService = {
            chat,
            estimateCost: jest.fn().mockReturnValue(0.005),
        } as unknown as AIService;
        command = new GenerateWbCharcsCommand(aiService);
    });

    it('should stop chain if no charcs', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: 'Desc', subjectId: 2009,
            charcs: [],
        };
        const result = await command.execute(ctx);
        expect(result.stopChain).toBe(true);
        expect(chat).not.toHaveBeenCalled();
    });

    it('should parse AI response and set aiCharacteristics', async () => {
        chat.mockResolvedValue({
            content: '{"characteristics": [{"id": 5023, "value": "LRS-350-24"}, {"id": 355421, "value": 24}]}',
            usage: { input_tokens: 500, output_tokens: 100 },
        });

        const ctx: IWbCreateCardContext = {
            productName: 'LRS-350-24 Блок питания',
            description: 'Блок питания 24В 350Вт',
            subjectId: 2009,
            charcs: mockCharcs,
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBeUndefined();
        expect(result.aiCharacteristics).toHaveLength(2);
        expect(result.aiCharacteristics[0]).toEqual({ id: 5023, value: 'LRS-350-24' });
        expect(result.aiCharacteristics[1]).toEqual({ id: 355421, value: 24 });
        expect(result.aiCost).toBeDefined();
        expect(result.aiCost.cost).toBe(0.005);
    });

    it('should stop chain on invalid JSON', async () => {
        chat.mockResolvedValue({
            content: 'sorry I cannot help',
            usage: { input_tokens: 100, output_tokens: 10 },
        });

        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: 'Desc', subjectId: 2009,
            charcs: mockCharcs,
        };
        const result = await command.execute(ctx);
        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('невалидный JSON');
    });

    it('should pass web_search option to AI', async () => {
        chat.mockResolvedValue({
            content: '{"characteristics": []}',
            usage: { input_tokens: 100, output_tokens: 10 },
        });

        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: 'Desc', subjectId: 2009,
            charcs: mockCharcs,
            webSearch: true,
        };
        await command.execute(ctx);

        expect(chat).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ web_search: true }),
        );
    });
});
