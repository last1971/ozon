import { ShortenTitleCommand } from './shorten-title.command';
import { AIService } from '../../ai/ai.service';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';

describe('ShortenTitleCommand', () => {
    let command: ShortenTitleCommand;
    let shortenTitle: jest.Mock;

    beforeEach(() => {
        shortenTitle = jest.fn();
        command = new ShortenTitleCommand({ shortenTitle } as unknown as AIService);
    });

    it('should shorten long title via AI', async () => {
        shortenTitle.mockResolvedValue({
            title: 'LRS-350-24 Блок питания 24В 350Вт',
            original: 'LRS-350-24, Блок питания корпусной 24В 14,6А 350Вт (MW)',
        });

        const ctx: IWbCreateCardContext = {
            productName: '', description: '', subjectId: 0,
            ozonName: 'LRS-350-24, Блок питания корпусной 24В 14,6А 350Вт (MW)',
        };
        const result = await command.execute(ctx);

        expect(result.title).toBe('LRS-350-24 Блок питания 24В 350Вт');
        expect(shortenTitle).toHaveBeenCalledWith(ctx.ozonName, 60);
    });

    it('should return original if short enough', async () => {
        const shortName = 'Короткое название';
        shortenTitle.mockResolvedValue({ title: shortName, original: shortName });

        const ctx: IWbCreateCardContext = {
            productName: '', description: '', subjectId: 0,
            ozonName: shortName,
        };
        const result = await command.execute(ctx);

        expect(result.title).toBe(shortName);
    });

    it('should fallback to productName if ozonName is empty', async () => {
        shortenTitle.mockResolvedValue({ title: 'Fallback', original: 'Fallback' });

        const ctx: IWbCreateCardContext = {
            productName: 'Fallback', description: '', subjectId: 0,
        };
        const result = await command.execute(ctx);

        expect(shortenTitle).toHaveBeenCalledWith('Fallback', 60);
    });

    it('should skip AI when title is already set', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Original', description: '', subjectId: 0,
            title: 'Ручное название',
        };
        const result = await command.execute(ctx);

        expect(result.title).toBe('Ручное название');
        expect(shortenTitle).not.toHaveBeenCalled();
    });
});
