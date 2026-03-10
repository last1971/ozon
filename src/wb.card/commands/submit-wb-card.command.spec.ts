import { SubmitWbCardCommand } from './submit-wb-card.command';
import { WbApiService } from '../../wb.api/wb.api.service';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';

describe('SubmitWbCardCommand', () => {
    let command: SubmitWbCardCommand;
    let method: jest.Mock;

    beforeEach(() => {
        method = jest.fn();
        command = new SubmitWbCardCommand({ method } as unknown as WbApiService);
    });

    it('should submit and save full response', async () => {
        const apiResponse = { data: { taskId: '12345' } };
        method.mockResolvedValue(apiResponse);

        const uploadBody = [{ subjectID: 2009, variants: [{}] }];
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            uploadBody,
        };
        const result = await command.execute(ctx);

        expect(result.uploadResult).toEqual(apiResponse);
        expect(result.stopChain).toBeUndefined();
        expect(method).toHaveBeenCalledWith(
            'https://content-api.wildberries.ru/content/v2/cards/upload',
            'post',
            uploadBody,
            true,
        );
    });

    it('should stopChain on API error', async () => {
        method.mockResolvedValue({
            error: { message: 'Unauthorized', status: 401 },
        });

        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            uploadBody: [],
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('WB API');
        expect(result.uploadResult).toBeDefined();
    });
});
