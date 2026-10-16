import { AllocateSpisCodeCommand } from './allocate-spis-code.command';
import { CreateSpisDocCommand } from './create-spis-doc.command';

const t = {} as any;
const spis = { goodscode: '1', username: 'u', quan: -2, prim: 'пересортица', osnSpisId: 1 };

describe('AllocateSpisCodeCommand', () => {
    it('номер заранее и в контекст транзакции всегда', async () => {
        const stock = { allocateSpisCode: jest.fn(async () => 42), setSpisContext: jest.fn() };
        const res = await new AllocateSpisCodeCommand(stock as any).execute({ t, extra: 1 });
        expect(stock.setSpisContext).toHaveBeenCalledWith(42, t);
        expect(res).toEqual({ t, extra: 1, spisCode: 42 });
    });
});

describe('CreateSpisDocCommand', () => {
    it('списание по spis из контекста, документ проверен по номеру', async () => {
        const stock = { spisanie: jest.fn(), spisDocExists: jest.fn(async () => true) };
        await new CreateSpisDocCommand(stock as any).execute({ t, spis, spisCode: 42 });
        expect(stock.spisanie).toHaveBeenCalledWith(spis, t);
        expect(stock.spisDocExists).toHaveBeenCalledWith(42, t);
    });
    it('документа с выданным номером нет — сбой, всё откатится', async () => {
        const stock = { spisanie: jest.fn(), spisDocExists: jest.fn(async () => false) };
        await expect(new CreateSpisDocCommand(stock as any).execute({ t, spis, spisCode: 42 })).rejects.toThrow(
            /42 не создан/,
        );
    });
    it('spis не подготовлен — сбой до похода в базу', async () => {
        const stock = { spisanie: jest.fn() };
        await expect(new CreateSpisDocCommand(stock as any).execute({ t, spisCode: 42 })).rejects.toThrow(
            /не подготовлен/,
        );
        expect(stock.spisanie).not.toHaveBeenCalled();
    });
});
