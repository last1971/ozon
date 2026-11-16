import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LoadShortageLineCommand } from './load-shortage-line.command';
import { AssertNotMarkedCommand } from './assert-not-marked.command';
import { BuildPeresortDocCommand } from './build-peresort-doc.command';
import { PickupLineCommand } from './pickup-line.command';
import { CloseShortageCommand } from './close-shortage.command';
import { PERESORT_OSN_SPIS_ID, PeresortContext } from './peresort.context';

const t = { id: 'tx' } as any;
const line = (over: Partial<any> = {}) => ({
    realpricecode: 900,
    goodscode: '557614',
    name: 'ECAP 100/450V',
    quantity: 2,
    pieces: 1,
    podbposcode: 11,
    picked: 1,
    need: 2,
    shipped: 0,
    ...over,
});
const ctx = (over: Partial<PeresortContext> = {}): PeresortContext => ({
    t,
    posting: 'P-1',
    scode: 500,
    realpricecode: 900,
    username: 'Ластовка',
    ...over,
});

describe('LoadShortageLineCommand', () => {
    const stock = { getLines: jest.fn() };
    const cmd = new LoadShortageLineCommand(stock as any);

    it('недобор строки = нужно − подобрано', async () => {
        stock.getLines.mockResolvedValue([line({ realpricecode: 1 }), line()]);
        const res = await cmd.execute(ctx());
        expect(stock.getLines).toHaveBeenCalledWith(500, t);
        expect(res.line.realpricecode).toBe(900);
        expect(res.quantity).toBe(1);
    });

    it('строки нет → 404', async () => {
        stock.getLines.mockResolvedValue([line({ realpricecode: 1 })]);
        await expect(cmd.execute(ctx())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('недобора нет → 400', async () => {
        stock.getLines.mockResolvedValue([line({ picked: 2 })]);
        await expect(cmd.execute(ctx())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('недобор не кратен фасовке → 400; фасовка неизвестна — не проверяем', async () => {
        stock.getLines.mockResolvedValue([line({ quantity: 10, picked: 5, pieces: 4 })]);
        await expect(cmd.execute(ctx())).rejects.toThrow(/не кратен фасовке 4/);
        stock.getLines.mockResolvedValue([line({ quantity: 10, picked: 5, pieces: null })]);
        expect((await cmd.execute(ctx())).quantity).toBe(5);
    });
});

describe('AssertNotMarkedCommand', () => {
    const stock = { isMarkRequired: jest.fn() };
    const cmd = new AssertNotMarkedCommand(stock as any);

    it('маркируемый → 400 с названием', async () => {
        stock.isMarkRequired.mockResolvedValue(true);
        await expect(cmd.execute(ctx({ line: line() as any }))).rejects.toThrow(/ECAP 100\/450V: товар маркируемый/);
        expect(stock.isMarkRequired).toHaveBeenCalledWith('557614', t);
    });

    it('обычный — дальше', async () => {
        stock.isMarkRequired.mockResolvedValue(false);
        const c = ctx({ line: line() as any });
        expect(await cmd.execute(c)).toBe(c);
    });
});

describe('BuildPeresortDocCommand', () => {
    it('документ: списание с МИНУСОМ на недобор, основание «пересортица», примечание со счётом', async () => {
        const res = await new BuildPeresortDocCommand().execute(ctx({ line: line() as any, quantity: 1 }));
        expect(res.spis).toEqual({
            goodscode: '557614',
            username: 'Ластовка',
            quan: -1,
            prim: 'пересортица, недобор FBO, счёт 500 (P-1)',
            osnSpisId: PERESORT_OSN_SPIS_ID,
        });
    });
});

describe('PickupLineCommand', () => {
    const stock = { getLines: jest.fn(), ensurePodbLine: jest.fn(), updatePodb: jest.fn() };
    const cmd = new PickupLineCommand(stock as any);
    beforeEach(() => {
        Object.values(stock).forEach((m) => m.mockReset());
        stock.getLines.mockResolvedValue([line()]);
    });

    it('строка подборки есть: «подобрано» +недобор, «нужно» не трогаем (уже знает)', async () => {
        await cmd.execute(ctx({ line: line() as any, quantity: 1 }));
        expect(stock.ensurePodbLine).not.toHaveBeenCalled();
        expect(stock.updatePodb).toHaveBeenCalledWith(
            { goodscode: '557614', deltaQuan: 1, deltaNeed: 0, realpricecode: 900, scode: 500, username: 'Ластовка' },
            t,
        );
    });

    it('строки подборки нет: сперва пустая строка, «нужно» — до количества строки', async () => {
        stock.getLines.mockResolvedValue([line({ podbposcode: null, picked: 0, need: 0 })]);
        await cmd.execute(ctx({ line: line({ podbposcode: null, picked: 0, need: 0 }) as any, quantity: 2 }));
        expect(stock.ensurePodbLine).toHaveBeenCalledWith({ scode: 500, goodscode: '557614', realpricecode: 900 }, t);
        expect(stock.updatePodb).toHaveBeenCalledWith(expect.objectContaining({ deltaQuan: 2, deltaNeed: 2 }), t);
    });
    it.each([
        [0, 5, 0],
        [2, 5, 0],
        [2, 5, 2],
        [0, 0, 0],
        [0, 2, 0],
        [5, 5, 0],
    ])('приход: заявка %i → %i, уже подобрано %i; итог ровно 5', async (oldNeed, freshNeed, picked) => {
        const state = line({ quantity: 5, need: oldNeed, picked, podbposcode: oldNeed ? 11 : null });
        const neighbour = line({ realpricecode: 901, quantity: 10, need: 10, picked: 3 });
        stock.getLines.mockImplementation(async () => [{ ...state }, { ...neighbour }]);
        const loaded = await new LoadShortageLineCommand(stock as any).execute(ctx());
        // Побочный эффект приходной процедуры между шагами цепочки.
        state.need = freshNeed;
        state.podbposcode = freshNeed ? 11 : null;
        stock.updatePodb.mockImplementation(async (p) => {
            expect(p.realpricecode).toBe(900);
            state.need += p.deltaNeed;
            state.picked += p.deltaQuan;
        });
        await cmd.execute(loaded);
        expect(state).toMatchObject({ need: 5, picked: 5 });
        expect(neighbour).toMatchObject({ need: 10, picked: 3 });
        expect(stock.getLines).toHaveBeenLastCalledWith(500, t);
        await expect(new LoadShortageLineCommand(stock as any).execute(ctx())).rejects.toThrow(/недобора нет/);
    });

    it.each([
        [],
        [line(), line()],
        [line({ goodscode: 'other' })],
        [line({ quantity: 3 })],
        [line({ picked: 2 })],
        [line({ shipped: 1 })],
        [line({ pieces: 2 })],
        [line({ need: 4 })],
    ])('изменённая или повреждённая строка: отказ без записи (%j)', async (...fresh) => {
        stock.getLines.mockResolvedValue(fresh);
        await expect(cmd.execute(ctx({ line: line() as any, quantity: 1 }))).rejects.toBeInstanceOf(ConflictException);
        expect(stock.ensurePodbLine).not.toHaveBeenCalled();
        expect(stock.updatePodb).not.toHaveBeenCalled();
    });
});

describe('CloseShortageCommand', () => {
    it('закрывает журнал по товару на недобор той же точкой, что доноры', async () => {
        const closer = { close: jest.fn().mockResolvedValue({ shortageClosed: true, pickedUp: true }) };
        const cmd = new CloseShortageCommand(closer as any);
        const res = await cmd.execute(ctx({ line: line() as any, quantity: 1 }));
        expect(closer.close).toHaveBeenCalledWith('P-1', 500, new Map([['557614', 1]]), t);
        expect(res).toMatchObject({ shortageClosed: true, pickedUp: true });
    });
});
