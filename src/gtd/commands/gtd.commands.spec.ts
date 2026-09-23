import { PartyReceiptGtdCommand } from './party-receipt.gtd.command';
import { LastGoodReceiptGtdCommand } from './last-good-receipt.gtd.command';
import { IGtdContext } from '../gtd.context';

describe('команды-источники ГТД', () => {
    const query = jest.fn();
    const ctx = (over: Partial<IGtdContext> = {}): IGtdContext => ({
        partyId: 2932628,
        goodscode: '565565',
        partyDate: new Date('2026-08-03'),
        transaction: { query } as any,
        candidates: [],
        ...over,
    });

    beforeEach(() => query.mockReset());

    describe('PartyReceiptGtdCommand', () => {
        const command = new PartyReceiptGtdCommand();

        it('обе ветки прихода в одном COALESCE: SKLADIN и SHOPIN→SHOPINPR', async () => {
            query.mockResolvedValueOnce([{ GTD: '10005030/260623/3170340/1' }]);
            const res = await command.execute(ctx());

            expect(res.candidates).toEqual(['10005030/260623/3170340/1']);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('COALESCE((SELECT sk.GTD FROM SKLADIN sk WHERE sk.SKLADINCODE = pm.SKLADINCODE)');
            expect(sql).toContain('JOIN SHOPINPR sp ON sp.SHOPINPRCODE = si.SHOPINPRCODE');
            expect(sql).toContain('WHERE si.SHOPINCODE = pm.SHOPINCODE');
            expect(query.mock.calls[0][1]).toEqual([2932628]);
        });

        it.each([
            [[{ GTD: null }], 'ГТД пуста'],
            [[], 'партии нет'],
        ])('%#: %s → кандидатов нет', async (rows) => {
            query.mockResolvedValueOnce(rows);
            expect((await command.execute(ctx())).candidates).toEqual([]);
        });
    });

    describe('LastGoodReceiptGtdCommand', () => {
        const command = new LastGoodReceiptGtdCommand();

        it('приходы товара не позже даты партии, свежие первыми, сама партия исключена', async () => {
            query.mockResolvedValueOnce([
                { GTD: '10131010/250526/5164730/1' },
                { GTD: null },
                { GTD: '10013160/030324/3074100/1' },
            ]);
            const res = await command.execute(ctx());

            // null-строки отсеиваем здесь: кандидат — это номер, а не его отсутствие.
            expect(res.candidates).toEqual(['10131010/250526/5164730/1', '10013160/030324/3074100/1']);
            const sql = query.mock.calls[0][0];
            expect(sql).toContain('FROM PR_META pm');
            expect(sql).toContain('pm.GOODSCODE = ?');
            expect(sql).toContain('pm.P_R = 0');
            expect(sql).toContain('pm.ID <> ?');
            expect(sql).toContain('AND pm.DATA <= ?');
            expect(sql).toContain('ORDER BY pm.DATA DESC, pm.ID DESC');
            expect(query.mock.calls[0][1]).toEqual(['565565', 2932628, new Date('2026-08-03')]);
        });

        it('даты партии нет — ограничение по дате не накладываем', async () => {
            query.mockResolvedValueOnce([]);
            await command.execute(ctx({ partyDate: null }));

            expect(query.mock.calls[0][0]).not.toContain('pm.DATA <= ?');
            expect(query.mock.calls[0][1]).toEqual(['565565', 2932628]);
        });
    });
});
