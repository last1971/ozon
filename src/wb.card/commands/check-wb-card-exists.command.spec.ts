import { CheckWbCardExistsCommand } from './check-wb-card-exists.command';
import { WbCardService } from '../wb.card.service';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';

describe('CheckWbCardExistsCommand', () => {
    let command: CheckWbCardExistsCommand;
    let getWbCardAsync: jest.Mock;

    beforeEach(() => {
        getWbCardAsync = jest.fn();
        command = new CheckWbCardExistsCommand({ getWbCardAsync } as unknown as WbCardService);
    });

    it('should pass if card does not exist', async () => {
        getWbCardAsync.mockResolvedValue(null);

        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 0,
            offerId: '531557',
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBeUndefined();
        expect(getWbCardAsync).toHaveBeenCalledWith('531557');
    });

    it('should stopChain if card already exists', async () => {
        getWbCardAsync.mockResolvedValue({ nmID: 542516127, vendorCode: '531557' });

        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 0,
            offerId: '531557',
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('уже существует');
        expect(result.error_message).toContain('542516127');
    });
});
