import { AssertWriteOffAllowedCommand } from './assert-write-off-allowed.command';
import { AllocateSpisCodeCommand } from './allocate-spis-code.command';
import { CreateWriteOffDocCommand } from './create-write-off-doc.command';
import { RunWriteOffCommand } from './run-write-off.command';
import { WriteOffContext } from './return.contexts';

const wctx = (over: Partial<WriteOffContext> = {}): WriteOffContext => ({
    t: {} as any,
    service: 'OZON',
    extId: '1',
    posting: 'P-1',
    goodscode: '552293',
    quan: 1,
    kis: [],
    username: 'Кладовщик',
    osnSpisId: 4,
    comment: null,
    ...over,
});

describe('AssertWriteOffAllowedCommand', () => {
    const make = (rec: any, stock: any) =>
        new AssertWriteOffAllowedCommand(
            { find: jest.fn(async () => rec) } as any,
            {
                hasFreeMarkCodes: jest.fn(async () => false),
                stockAndReserve: jest.fn(async () => ({ stock: 5, reserved: 0, reservedBy: [] })),
                ...stock,
            } as any,
        );
    const accepted = { decision: 'RETURN', spisCode: null };

    it('не принят / проблема / уже списан — отказ', async () => {
        await expect(make(null, {}).execute(wctx())).rejects.toThrow('только принятый');
        await expect(make({ decision: 'PROBLEM' }, {}).execute(wctx())).rejects.toThrow('только принятый');
        await expect(make({ ...accepted, spisCode: 7 }, {}).execute(wctx())).rejects.toThrow('Уже списан');
    });
    it('маркируемый без марок при свободных кодах — в Trade со сканом', async () => {
        const c = make(accepted, { hasFreeMarkCodes: jest.fn(async () => true) });
        await expect(c.execute(wctx())).rejects.toThrow('спишите в Trade со сканом');
        await expect(c.execute(wctx({ kis: ['k'] }))).resolves.toBeTruthy();
    });
    it('резерв не даёт списать — текст со счетами', async () => {
        const c = make(accepted, {
            stockAndReserve: jest.fn(async () => ({ stock: 1, reserved: 1, reservedBy: [20849] })),
        });
        await expect(c.execute(wctx())).rejects.toThrow('Товар в резерве под счёт 20849');
    });
});

describe('AllocateSpisCodeCommand', () => {
    it('контекст выставляется всегда, и без марок', async () => {
        const stock = { allocateSpisCode: jest.fn(async () => 9485), setSpisContext: jest.fn() };
        const res = await new AllocateSpisCodeCommand(stock as any).execute(wctx({ kis: [] }));
        expect(res.spisCode).toBe(9485);
        expect(stock.setSpisContext).toHaveBeenCalledWith(9485, expect.anything());
    });
});

describe('CreateWriteOffDocCommand', () => {
    it('документа с выданным номером нет — сбой, всё откатится', async () => {
        const stock = { spisanie: jest.fn(), spisDocExists: jest.fn(async () => false) };
        await expect(new CreateWriteOffDocCommand(stock as any).execute(wctx({ spisCode: 1 }))).rejects.toThrow(
            'не создан',
        );
        expect(stock.spisanie).toHaveBeenCalledWith(
            expect.objectContaining({ goodscode: '552293', quan: 1, prim: 'Возврат P-1', osnSpisId: 4 }),
            expect.anything(),
        );
    });
});

describe('RunWriteOffCommand', () => {
    it('без основания — отказ, цепочка списания не запускается', async () => {
        const chain = { execute: jest.fn() };
        await expect(new RunWriteOffCommand(chain).execute({ osnSpisId: null } as any)).rejects.toThrow('основание');
        expect(chain.execute).not.toHaveBeenCalled();
    });
    it('передаёт приём в списание той же транзакцией', async () => {
        const chain = { execute: jest.fn(async (c) => ({ ...c, spisCode: 5 })) };
        const t = {};
        const res = await new RunWriteOffCommand(chain).execute({
            t,
            osnSpisId: 4,
            username: 'u',
            comment: null,
            kis: ['k'],
            line: { service: 'OZON', extId: '1', posting: 'P-1' },
            card: { quan: 2, invoiceLine: { goodscode: '552293' } },
        } as any);
        expect(chain.execute).toHaveBeenCalledWith(
            expect.objectContaining({ t, goodscode: '552293', quan: 2, kis: ['k'] }),
        );
        expect(res.writeOff.spisCode).toBe(5);
    });
});
