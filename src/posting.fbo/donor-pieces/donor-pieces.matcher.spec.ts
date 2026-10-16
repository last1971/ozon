import * as iconv from 'iconv-lite';
import { journalSafe, journalState, matchSupply, parseSupplyNumber } from './donor-pieces.matcher';
import { DonorPiecesInvoice, DonorPiecesLine } from './donor-pieces.types';

const line = (realpricecode: number, goodscode: string, quantity: number, pieces: number | null = null): DonorPiecesLine => ({
    realpricecode,
    goodscode,
    quantity,
    pieces,
});
const invoice = (lines: DonorPiecesLine[]): DonorPiecesInvoice => ({
    scode: 290912,
    invoiceNumber: 68058,
    prim: '2000062193308 Новосибирск FORFBO',
    supplyNumber: '2000062193308',
    lines,
});

describe('parseSupplyNumber', () => {
    it('13 цифр из примечания; лишние пробелы и текст не мешают', () => {
        expect(parseSupplyNumber('2000062193308 Новосибирск FORFBO')).toBe('2000062193308');
        expect(parseSupplyNumber('2000068792487  Екатеринбург FORFBO')).toBe('2000068792487');
    });
    it('нет номера или цифр не 13 → null', () => {
        expect(parseSupplyNumber('Электросталь FORFBO')).toBeNull();
        expect(parseSupplyNumber('20000621933081 FORFBO')).toBeNull();
        expect(parseSupplyNumber(null)).toBeNull();
    });
});

describe('matchSupply', () => {
    it('живой пример 68058: фасовка = суффикс артикула, штуки сходятся по всем товарам', () => {
        const res = matchSupply(
            invoice([line(736870, '328525', 25), line(736872, '420357', 6), line(736879, '361118', 3), line(736883, '560209', 3)]),
            [
                { offerId: '328525-5', units: 5 },
                { offerId: '420357-2', units: 3 },
                { offerId: '361118', units: 3 },
                { offerId: '560209-1', units: 3 },
            ],
        );
        expect(res.disputes).toEqual([]);
        expect(res.fills).toEqual([
            { realpricecode: 736870, goodscode: '328525', pieces: 5 },
            { realpricecode: 736872, goodscode: '420357', pieces: 2 },
            { realpricecode: 736879, goodscode: '361118', pieces: 1 },
            { realpricecode: 736883, goodscode: '560209', pieces: 1 },
        ]);
    });

    it('строка уже с фасовкой не переписывается и в выборку записи не идёт', () => {
        const res = matchSupply(invoice([line(1, '420357', 6, 2)]), [{ offerId: '420357-2', units: 3 }]);
        expect(res).toEqual({ fills: [], disputes: [] });
    });

    it('штуки не сошлись → спор, строку не трогаем', () => {
        const res = matchSupply(invoice([line(1, '420357', 5)]), [{ offerId: '420357-2', units: 3 }]);
        expect(res.fills).toEqual([]);
        expect(res.disputes).toEqual([
            { realpricecode: 1, goodscode: '420357', reason: 'в счёте 5 шт, в поставке 6 шт (420357-2: 3 уп.)' },
        ]);
    });

    it('товара нет в поставке → спор', () => {
        const res = matchSupply(invoice([line(1, '420357', 6)]), [{ offerId: '328525-5', units: 5 }]);
        expect(res.disputes[0].reason).toBe('товара нет в поставке Озона');
    });

    it('две фасовки, одна строка → спор «разбейте строку»', () => {
        const res = matchSupply(invoice([line(1, '420357', 8)]), [
            { offerId: '420357', units: 2 },
            { offerId: '420357-2', units: 3 },
        ]);
        expect(res.fills).toEqual([]);
        expect(res.disputes[0].reason).toContain('несколькими фасовками: 420357: 2 уп., 420357-2: 3 уп.');
    });

    it('две фасовки, две строки с однозначными штуками → каждой своя', () => {
        const res = matchSupply(invoice([line(1, '420357', 2), line(2, '420357', 6)]), [
            { offerId: '420357', units: 2 },
            { offerId: '420357-2', units: 3 },
        ]);
        expect(res.disputes).toEqual([]);
        expect(res.fills).toEqual([
            { realpricecode: 1, goodscode: '420357', pieces: 1 },
            { realpricecode: 2, goodscode: '420357', pieces: 2 },
        ]);
    });

    it('две фасовки с равными штуками (4 × 1 и 2 × 2) — соответствие не единственное → спор', () => {
        const res = matchSupply(invoice([line(1, '420357', 4), line(2, '420357', 4)]), [
            { offerId: '420357', units: 4 },
            { offerId: '420357-2', units: 2 },
        ]);
        expect(res.fills).toEqual([]);
        expect(res.disputes).toHaveLength(1);
        expect(res.disputes[0].realpricecode).toBeNull();
    });

    it('количество строки не кратно фасовке → спор', () => {
        const res = matchSupply(invoice([line(1, '420357', 3), line(2, '420357', 3)]), [{ offerId: '420357-2', units: 3 }]);
        expect(res.disputes[0].reason).toBe('количество строки не кратно фасовке 2');
    });

    it('мусорный суффикс «-0» → спор, а не фасовка 0', () => {
        const res = matchSupply(invoice([line(1, '444', 0)]), [{ offerId: '444-0', units: 3 }]);
        expect(res.fills).toEqual([]);
        expect(res.disputes[0].reason).toContain('непонятный артикул');
    });
});

describe('journalState', () => {
    const d = (reason: string) => ({ realpricecode: 1, goodscode: '420357', reason });

    it('не спор — само состояние', () => {
        expect(journalState({ outcome: 'DONE', disputes: [] })).toBe('DONE');
        expect(journalState({ outcome: 'NOT_FOUND', disputes: [] })).toBe('NOT_FOUND');
    });

    it('спор: тот же список — тот же отпечаток при любом порядке; другой — другой; ≤ 40 символов', () => {
        const a = journalState({ outcome: 'DISPUTE', disputes: [d('x'), d('y')] });
        expect(a).toMatch(/^DISPUTE:[0-9a-f]{8}$/);
        expect(a.length).toBeLessThanOrEqual(40);
        expect(journalState({ outcome: 'DISPUTE', disputes: [d('y'), d('x')] })).toBe(a);
        expect(journalState({ outcome: 'DISPUTE', disputes: [d('x')] })).not.toBe(a);
    });
});

describe('journalSafe — текст переживает однобайтовую кириллицу журнала', () => {
    const roundTrip = (t: string, cp: string) => iconv.decode(iconv.encode(t, cp), cp);

    it('×, тире, ёлочки → ?; кириллица, ё и цифры целы; результат кодируется без потерь в cp866 и cp1251', () => {
        const safe = journalSafe('товар 420357-2 × 3 — «разбейте» строку, счёт №68058 Ёё');
        expect(safe).toBe('товар 420357-2 ? 3 ? ?разбейте? строку, счёт ?68058 Ёё');
        for (const cp of ['cp866', 'cp1251']) expect(roundTrip(safe, cp)).toBe(safe);
    });

    it('все тексты споров сопоставления безопасны для журнала как есть', () => {
        const inv = { scode: 1, invoiceNumber: 1, prim: 'x', supplyNumber: '2000062193308' };
        const reasons = [
            ...matchSupply({ ...inv, lines: [{ realpricecode: 1, goodscode: '1', quantity: 5, pieces: null }] }, [{ offerId: '1-2', units: 3 }]).disputes,
            ...matchSupply({ ...inv, lines: [{ realpricecode: 1, goodscode: '1', quantity: 8, pieces: null }] }, [{ offerId: '1', units: 2 }, { offerId: '1-2', units: 3 }]).disputes,
            ...matchSupply({ ...inv, lines: [{ realpricecode: 1, goodscode: '1', quantity: 3, pieces: null }, { realpricecode: 2, goodscode: '1', quantity: 3, pieces: null }] }, [{ offerId: '1-2', units: 3 }]).disputes,
            ...matchSupply({ ...inv, lines: [{ realpricecode: 1, goodscode: '1', quantity: 0, pieces: null }] }, [{ offerId: '1-0', units: 3 }]).disputes,
            ...matchSupply({ ...inv, lines: [{ realpricecode: 1, goodscode: '1', quantity: 3, pieces: null }] }, []).disputes,
        ].map((d) => d.reason);
        expect(reasons).toHaveLength(5);
        for (const r of reasons) expect(journalSafe(r)).toBe(r);
    });
});
