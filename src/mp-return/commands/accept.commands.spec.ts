import { ValidateMarksCommand } from './validate-marks.command';
import { UnretireMarksCommand } from './unretire-marks.command';
import { ReleaseMarksCommand } from './release-marks.command';
import { DisbandPodbCommand } from './disband-podb.command';
import { RestateInvoiceCommand } from './restate-invoice.command';
import { AssertNotProcessedCommand } from './assert-not-processed.command';
import { AssertAcceptableCommand } from './assert-acceptable.command';
import { AssertProblemCommentCommand } from './assert-problem-comment.command';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext } from './return.contexts';
import { MarkScanPool } from '../mark-scan.pool';

const KI1 = '0104650194492385215gpBxjCjAX37v';
const KI2 = '0104650194492385215gpBxjCjAX38v';
const code = (ki: string, over: any = {}) => ({
    ki,
    quantity: 1,
    status: 5,
    transferType: 3,
    retireReason: null,
    chzSent: false,
    ...over,
});

const ctx = (over: any = {}, card: any = {}): AcceptContext =>
    ({
        t: {} as any,
        line: { service: 'OZON', extId: '1', posting: 'P-1', units: 1 } as any,
        action: 'return',
        username: 'Кладовщик',
        marks: new MarkScanPool([]),
        comment: null,
        osnSpisId: null,
        kis: [],
        retiredKis: [],
        card: {
            invoice: { scode: 10, number: 20008, status: 0, isDonor: false, mark: '' },
            invoiceLine: { realpricecode: 100, goodscode: '538612', picked: 1, need: 0 },
            codes: [],
            quan: 1,
            marksRequired: false,
            accepted: null,
            blockers: [],
            ...card,
        },
        ...over,
    }) as AcceptContext;

describe('проверки приёма', () => {
    it('уже принят / проблема — отказ', async () => {
        const accepted = { decision: 'RETURN', username: 'u', createdAt: '2026-10-15T00:00:00Z' };
        await expect(new AssertNotProcessedCommand().execute(ctx({}, { accepted }))).rejects.toThrow('уже принят');
    });
    it('причины из оценки — отказ одним текстом', async () => {
        await expect(new AssertAcceptableCommand().execute(ctx({}, { blockers: ['a', 'b'] }))).rejects.toThrow('a; b');
    });
    it('проблема без комментария — отказ', async () => {
        await expect(new AssertProblemCommentCommand().execute(ctx({ comment: '  ' }))).rejects.toBeInstanceOf(
            ReturnRefusedError,
        );
    });
});

describe('ValidateMarksCommand', () => {
    /** Шаг + проверка пула после кнопки — как в сервисе. */
    const run = async (scans: string[], card: any) => {
        const marks = new MarkScanPool(scans);
        const res = await new ValidateMarksCommand().execute(ctx({ marks }, card));
        marks.assertAllUsed();
        return res;
    };

    it('кодов на строке нет — сканы не нужны', async () => {
        expect((await run([], {})).kis).toEqual([]);
        await expect(run([KI1], {})).rejects.toThrow('Марки не нужны');
    });
    it('чужой код — отказ', async () => {
        await expect(run([KI2], { marksRequired: true, codes: [code(KI1)] })).rejects.toThrow('не с этой строки');
    });
    it('штуки по QUANTITY: 20 шт = 2 марки по 10, повтор скана не считается дважды', async () => {
        const card = {
            marksRequired: true,
            quan: 20,
            codes: [code(KI1, { quantity: 10 }), code(KI2, { quantity: 10 })],
        };
        expect((await run([KI1, KI2, KI1], card)).kis).toEqual([KI1, KI2]);
        await expect(run([KI1], card)).rejects.toThrow('марок на 10 шт, вернулось 20');
    });
});

describe('UnretireMarksCommand', () => {
    it('6/1 → 6→5; в очередь ГИС МТ только ушедшие туда', async () => {
        const invoice = { markCodeFbsUnsold: jest.fn() };
        const c = ctx(
            { kis: [KI1, KI2] },
            {
                codes: [
                    code(KI1, { status: 6, retireReason: 1, chzSent: true }),
                    code(KI2, { status: 6, retireReason: 1 }),
                ],
            },
        );
        const res = await new UnretireMarksCommand(invoice as any).execute(c);
        expect(invoice.markCodeFbsUnsold).toHaveBeenCalledTimes(2);
        expect(res.retiredKis).toEqual([KI1]);
    });
});

describe('ReleaseMarksCommand', () => {
    it('сначала отвязка от строки, потом TT→0 (иначе резерв партии снимается дважды)', async () => {
        const order: string[] = [];
        const stock = { storageSS: () => 0, detachFromRealprice: jest.fn(async () => void order.push('detach')) };
        const invoice = { markCodeReturnToStock: jest.fn(async () => void order.push('toStock')) };
        await new ReleaseMarksCommand(stock as any, invoice as any).execute(
            ctx({ kis: [KI1, KI2] }, { codes: [code(KI1), code(KI2, { transferType: 0 })] }),
        );
        expect(order).toEqual(['detach', 'toStock', 'detach']);
        expect(stock.detachFromRealprice).toHaveBeenCalledWith(KI1, 100, expect.anything());
    });
});

describe('DisbandPodbCommand', () => {
    it('«нужно» уменьшается не ниже нуля', async () => {
        const stock = { updatePodb: jest.fn() };
        await new DisbandPodbCommand(stock as any).execute(
            ctx({}, { quan: 10, invoiceLine: { realpricecode: 100, goodscode: '524924', picked: 10, need: 0 } }),
        );
        expect(stock.updatePodb).toHaveBeenCalledWith(
            expect.objectContaining({
                deltaQuan: -10,
                deltaNeed: -0,
                realpricecode: 100,
                scode: 10,
                username: 'Кладовщик',
            }),
            expect.anything(),
        );
    });
});

describe('RestateInvoiceCommand', () => {
    const stockWith = (hasPicked: boolean) => ({
        hasPicked: jest.fn(async () => hasPicked),
        setInvoiceStatus: jest.fn(),
        setLineQuantitiesToPicked: jest.fn(),
    });
    const statuses = (s: any) => s.setInvoiceStatus.mock.calls.map((c: any[]) => c[1]);

    it('подборки не осталось → 0', async () => {
        const s = stockWith(false);
        await new RestateInvoiceCommand(s as any).execute(
            ctx({}, { invoice: { scode: 10, status: 4, isDonor: false } }),
        );
        expect(statuses(s)).toEqual([0]);
        expect(s.setLineQuantitiesToPicked).not.toHaveBeenCalled();
    });
    it('частичный возврат собранного → 0, количество = подобрано, 4', async () => {
        const s = stockWith(true);
        await new RestateInvoiceCommand(s as any).execute(
            ctx({}, { invoice: { scode: 10, status: 4, isDonor: false } }),
        );
        expect(statuses(s)).toEqual([0, 4]);
        expect(s.setLineQuantitiesToPicked).toHaveBeenCalledWith(10, expect.anything());
    });
    it('частичный возврат донора → 1', async () => {
        const s = stockWith(true);
        await new RestateInvoiceCommand(s as any).execute(
            ctx({}, { invoice: { scode: 10, status: 3, isDonor: true } }),
        );
        expect(statuses(s)).toEqual([0, 1]);
    });
    it('счёт уже отменён (0) — не пересобираем', async () => {
        const s = stockWith(true);
        await new RestateInvoiceCommand(s as any).execute(
            ctx({}, { invoice: { scode: 10, status: 0, isDonor: false } }),
        );
        expect(s.setInvoiceStatus).not.toHaveBeenCalled();
    });
});
