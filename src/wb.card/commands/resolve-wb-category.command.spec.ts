import { ResolveWbCategoryCommand } from './resolve-wb-category.command';
import { OzonCategoryService } from '../../ozon.category/ozon.category.service';
import { IWbCreateCardContext, WbCategoryMode } from '../interfaces/wb-create-card.interface';

describe('ResolveWbCategoryCommand', () => {
    let command: ResolveWbCategoryCommand;
    let searchWbByOzonType: jest.Mock;
    let searchWbCategory: jest.Mock;

    beforeEach(() => {
        searchWbByOzonType = jest.fn();
        searchWbCategory = jest.fn();
        command = new ResolveWbCategoryCommand({
            searchWbByOzonType,
            searchWbCategory,
        } as unknown as OzonCategoryService);
    });

    it('should use subjectId as-is for manual mode', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            categoryMode: WbCategoryMode.MANUAL,
        };
        const result = await command.execute(ctx);

        expect(result.subjectId).toBe(2009);
        expect(result.stopChain).toBeUndefined();
        expect(searchWbByOzonType).not.toHaveBeenCalled();
        expect(searchWbCategory).not.toHaveBeenCalled();
    });

    it('should stopChain if manual mode without subjectId', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 0,
            categoryMode: WbCategoryMode.MANUAL,
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('subjectId');
    });

    it('should search by ozon type_id', async () => {
        searchWbByOzonType.mockResolvedValue([
            { subjectID: 526, name: 'Адаптеры', parentName: 'Электроника', similarity: 0.9 },
        ]);

        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 0,
            categoryMode: WbCategoryMode.BY_OZON_TYPE,
            typeId: 99309,
        };
        const result = await command.execute(ctx);

        expect(result.subjectId).toBe(526);
        expect(searchWbByOzonType).toHaveBeenCalledWith(99309);
    });

    it('should search by name', async () => {
        searchWbCategory.mockResolvedValue([
            { subjectID: 2009, name: 'Блоки питания', parentName: 'Электроника', similarity: 0.85 },
        ]);

        const ctx: IWbCreateCardContext = {
            productName: 'Блок питания', description: '', subjectId: 0,
            categoryMode: WbCategoryMode.BY_NAME,
            ozonName: 'Блок питания LRS-350',
        };
        const result = await command.execute(ctx);

        expect(result.subjectId).toBe(2009);
        expect(searchWbCategory).toHaveBeenCalledWith('Блок питания LRS-350');
    });

    it('should stopChain if no category found', async () => {
        searchWbCategory.mockResolvedValue([]);

        const ctx: IWbCreateCardContext = {
            productName: 'Unknown', description: '', subjectId: 0,
            categoryMode: WbCategoryMode.BY_NAME,
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('не найдена');
    });

    it('should stopChain if byOzonType without typeId', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 0,
            categoryMode: WbCategoryMode.BY_OZON_TYPE,
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('typeId');
    });
});
