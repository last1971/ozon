import { ConflictException } from '@nestjs/common';
import { DonorPiecesService } from './donor-pieces.service';
import { LoadDonorsCommand } from './commands/load-donors.command';
import { FetchSuppliesCommand } from './commands/fetch-supplies.command';
import { MatchSuppliesCommand } from './commands/match-supplies.command';
import { WritePiecesCommand } from './commands/write-pieces.command';
import { JournalOutcomesCommand } from './commands/journal-outcomes.command';
import { DonorPiecesInvoice, DonorPiecesResult } from './donor-pieces.types';

const t = { commit: jest.fn(), rollback: jest.fn().mockResolvedValue(undefined) } as any;
const inv = (over: Partial<DonorPiecesInvoice> = {}): DonorPiecesInvoice => ({
    scode: 290912,
    invoiceNumber: 68058,
    prim: '2000062193308 Новосибирск FORFBO',
    supplyNumber: '2000062193308',
    lines: [{ realpricecode: 736872, goodscode: '420357', quantity: 6, pieces: null }],
    ...over,
});

function build(opts: { invoices: DonorPiecesInvoice[]; lookup: (n: string) => any; setPieces?: jest.Mock; record?: jest.Mock }) {
    const store = { loadDonors: jest.fn().mockResolvedValue(opts.invoices), setPieces: opts.setPieces ?? jest.fn() };
    const client = { lookup: jest.fn(async (n: string) => opts.lookup(n)) };
    const journal = { record: opts.record ?? jest.fn().mockResolvedValue(true) };
    const invoiceService = { getTransaction: jest.fn().mockResolvedValue(t) };
    const config = { get: jest.fn().mockReturnValue(24416) };
    const events = { emit: jest.fn() };
    const service = new DonorPiecesService(
        invoiceService as any,
        new LoadDonorsCommand(store as any),
        new FetchSuppliesCommand(client as any),
        new MatchSuppliesCommand(),
        new WritePiecesCommand(store as any),
        new JournalOutcomesCommand(journal as any),
        config as any,
        events as any,
    );
    return { service, store, client, journal, events, invoiceService };
}

const found = (items: { offerId: string; units: number }[]) => ({ kind: 'found', items });

describe('DonorPiecesService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('кнопка: пишет фасовку, итог в журнал одной транзакцией, сводка без письма', async () => {
        const { service, store, journal, events, invoiceService } = build({
            invoices: [inv()],
            lookup: () => found([{ offerId: '420357-2', units: 3 }]),
        });
        const s = await service.run(false);

        expect(store.loadDonors).toHaveBeenCalledWith(24416);
        expect(store.setPieces).toHaveBeenCalledWith(736872, 2, t);
        expect(journal.record).toHaveBeenCalledWith(
            expect.objectContaining({ service: 'OZON', kind: 'DONOR_PIECES', extId: '2000062193308', state: 'DONE', posting: '68058' }),
            t,
        );
        expect(invoiceService.getTransaction).toHaveBeenCalledTimes(1);
        expect(t.commit).toHaveBeenCalled();
        expect(s).toMatchObject({ dry: false, checked: 1, suppliesFound: 1, lines: 1, done: 1, disputes: [] });
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('проверка без записи: ни записи, ни журнала, ни транзакции; строки — сколько было бы', async () => {
        const { service, store, journal, invoiceService } = build({
            invoices: [inv()],
            lookup: () => found([{ offerId: '420357-2', units: 3 }]),
        });
        const s = await service.run(true);
        expect(store.setPieces).not.toHaveBeenCalled();
        expect(journal.record).not.toHaveBeenCalled();
        expect(invoiceService.getTransaction).not.toHaveBeenCalled();
        expect(s).toMatchObject({ dry: true, lines: 1, done: 1 });
    });

    it('доноров нет → Озон не спрашиваем, транзакцию не открываем', async () => {
        const { service, client, invoiceService } = build({ invoices: [], lookup: () => found([]) });
        expect(await service.run(false)).toMatchObject({ checked: 0, lines: 0 });
        expect(client.lookup).not.toHaveBeenCalled();
        expect(invoiceService.getTransaction).not.toHaveBeenCalled();
    });

    it('база не приняла строку → строка в спор, остальное записано, в журнал — спор', async () => {
        const setPieces = jest.fn().mockImplementation(async (rpc: number) => {
            if (rpc === 2) throw new Error('Подобрано больше чем в счете');
        });
        const { service, journal } = build({
            invoices: [
                inv({
                    lines: [
                        { realpricecode: 1, goodscode: '420357', quantity: 6, pieces: null },
                        { realpricecode: 2, goodscode: '328525', quantity: 25, pieces: null },
                    ],
                }),
            ],
            lookup: () => found([{ offerId: '420357-2', units: 3 }, { offerId: '328525-5', units: 5 }]),
            setPieces,
        });
        const s = await service.run(false);
        expect(s.lines).toBe(1);
        expect(s.done).toBe(0);
        expect(s.disputes).toEqual([
            expect.objectContaining({ realpricecode: 2, goodscode: '328525', reason: 'база не приняла фасовку: Подобрано больше чем в счете' }),
        ]);
        expect(journal.record.mock.calls[0][0].state).toMatch(/^DISPUTE:/);
    });

    it('ошибка Озона и нет номера: в сводке; ошибка в журнал не идёт, «нет номера» — по SCODE', async () => {
        const { service, journal } = build({
            invoices: [inv(), inv({ scode: 5, invoiceNumber: 7, prim: 'Электросталь FORFBO', supplyNumber: null })],
            lookup: () => ({ kind: 'error', message: 'Ozon API error: 500' }),
        });
        const s = await service.run(false);
        expect(s.ozonErrors).toEqual([expect.objectContaining({ invoiceNumber: 68058, message: 'Ozon API error: 500' })]);
        expect(s.noNumber).toEqual([expect.objectContaining({ invoiceNumber: 7 })]);
        expect(journal.record).toHaveBeenCalledTimes(1);
        expect(journal.record.mock.calls[0][0]).toMatchObject({ extId: 'S5', state: 'NO_NUMBER' });
    });

    it('одна поставка на два счёта — Озон спрашиваем один раз', async () => {
        const { service, client } = build({
            invoices: [inv(), inv({ scode: 2, invoiceNumber: 2 })],
            lookup: () => found([{ offerId: '420357-2', units: 3 }]),
        });
        await service.run(true);
        expect(client.lookup).toHaveBeenCalledTimes(1);
    });

    it('второй одновременный проход → 409', async () => {
        let release: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const { service } = build({
            invoices: [inv()],
            lookup: async () => {
                await gate;
                return found([{ offerId: '420357-2', units: 3 }]);
            },
        });
        const first = service.run(true);
        await new Promise((r) => setImmediate(r));
        await expect(service.run(true)).rejects.toBeInstanceOf(ConflictException);
        release();
        await first;
        await expect(service.run(true)).resolves.toBeDefined();
    });

    describe('крон', () => {
        it('новый спор → письмо в OPS; тот же спор назавтра (журнал: не новое) → тишина', async () => {
            const record = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
            const { service, events } = build({
                invoices: [inv({ lines: [{ realpricecode: 1, goodscode: '420357', quantity: 8, pieces: null }] })],
                lookup: () => found([{ offerId: '420357', units: 2 }, { offerId: '420357-2', units: 3 }]),
                record,
            });
            await service.nightly();
            expect(events.emit).toHaveBeenCalledTimes(1);
            const [, subject, body, topic] = events.emit.mock.calls[0];
            expect(subject).toBe('Фасовка доноров FBO: разобрать руками 1');
            expect(body).toContain('Счёт №68058');
            expect(body).toContain('разбейте строку');
            expect(topic).toBe('OPS');

            events.emit.mockClear();
            await service.nightly();
            expect(events.emit).not.toHaveBeenCalled();
        });

        it('всё сошлось → письма нет', async () => {
            const { service, events } = build({ invoices: [inv()], lookup: () => found([{ offerId: '420357-2', units: 3 }]) });
            await service.nightly();
            expect(events.emit).not.toHaveBeenCalled();
        });

        it('проход упал целиком → письмо об ошибке, крон не роняет процесс', async () => {
            const { service, store, events } = build({ invoices: [], lookup: () => found([]) });
            store.loadDonors.mockRejectedValue(new Error('база недоступна'));
            await expect(service.nightly()).resolves.toBeUndefined();
            expect(events.emit).toHaveBeenCalledWith('error.message', 'Фасовка доноров FBO: проход не выполнен', 'база недоступна');
        });
    });

    it('письмо: «не найдено» и «нет номера» со своими подсказками', () => {
        const r = (outcome: DonorPiecesResult['outcome'], over: Partial<DonorPiecesInvoice> = {}): DonorPiecesResult => ({
            invoice: inv(over),
            outcome,
            fills: [],
            disputes: [],
            isNew: true,
        });
        const letter = DonorPiecesService.letter([r('NOT_FOUND'), r('NO_NUMBER', { supplyNumber: null }), r('DONE')]);
        expect(letter.subject).toBe('Фасовка доноров FBO: разобрать руками 2');
        expect(letter.body).toContain('Озон не знает поставку 2000062193308');
        expect(letter.body).toContain('допишите номер');
    });
});
