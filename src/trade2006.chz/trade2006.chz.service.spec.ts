import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FIREBIRD } from '../firebird/firebird.module';
import { Trade2006ChzService } from './trade2006.chz.service';

describe('Trade2006ChzService', () => {
    let service: Trade2006ChzService;
    const query = jest.fn();
    const execute = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const getTransaction = jest.fn();
    let markCodesEnabled: boolean | string = 'true';

    beforeEach(async () => {
        [query, execute, commit, rollback, getTransaction].forEach((m) => m.mockReset());
        markCodesEnabled = 'true';
        getTransaction.mockResolvedValue({ query, execute, commit, rollback });
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006ChzService,
                { provide: FIREBIRD, useValue: { getTransaction } },
                { provide: ConfigService, useValue: { get: () => markCodesEnabled } },
            ],
        }).compile();
        service = module.get(Trade2006ChzService);
    });

    it('маркировка выключена (магазин) → все методы схлопываются без SQL', async () => {
        markCodesEnabled = false;
        expect(await service.pending('retire')).toEqual([]);
        expect(await service.createBatch('retire')).toBeNull();
        expect(await service.confirmBatch(1)).toBeNull();
        expect(await service.listBatches()).toEqual([]);
        expect(getTransaction).not.toHaveBeenCalled();
    });

    it('pending(retire): гвард вывода — STATUS=6, RETIRE_REASON=1, TT=3, не передан', async () => {
        query.mockResolvedValueOnce([
            { KI: 'KI-1', GOODSCODE: 539090, PRICE: 1444, NS: 15438, PRIM: '68999952-0299-1', SINCE: null },
        ]);
        const rows = await service.pending('retire');
        const sql = query.mock.calls[0][0];
        expect(sql).toContain('m.STATUS = 6 AND m.RETIRE_REASON = 1 AND m.TRANSFER_TYPE = 3 AND m.CHZ_SENT_AT IS NULL');
        expect(rows).toEqual([
            { ki: 'KI-1', goodsCode: '539090', price: 1444, invoiceNumber: 15438, posting: '68999952-0299-1', since: null },
        ]);
    });

    it('pending(return): гвард возврата — код жив, а ЧЗ ещё считает его выведенным', async () => {
        query.mockResolvedValueOnce([]);
        await service.pending('return');
        expect(query.mock.calls[0][0]).toContain('m.STATUS = 5 AND m.CHZ_SENT_AT IS NOT NULL');
    });

    it('createBatch: пусто → null и откат, пачка не плодится', async () => {
        query.mockResolvedValueOnce([]);
        expect(await service.createBatch('retire')).toBeNull();
        expect(rollback).toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('createBatch: снимок текущего pending с номером из генератора', async () => {
        query
            .mockResolvedValueOnce([
                { KI: 'KI-1', GOODSCODE: 1, PRICE: 100, NS: 1, PRIM: 'p', SINCE: null },
                { KI: 'KI-2', GOODSCODE: 1, PRICE: 100, NS: 1, PRIM: 'p', SINCE: null },
            ])
            .mockResolvedValueOnce([{ ID: 7 }]);
        const batch = await service.createBatch('retire');
        expect(batch).toEqual({ id: 7, codes: expect.any(Array) });
        expect(execute.mock.calls[0]).toEqual([
            'INSERT INTO CHZ_BATCH (ID, KIND, CNT, SFCODE) VALUES (?, ?, ?, ?)',
            [7, 'retire', 2, null],
            false,
        ]);
        expect(execute.mock.calls[1][1]).toEqual([7, 'KI-1']);
        expect(execute.mock.calls[2][1]).toEqual([7, 'KI-2']);
        expect(commit).toHaveBeenCalled();
    });

    it('confirmBatch(retire): помечает только годных, считает пропущенных, пачку закрывает', async () => {
        query
            .mockResolvedValueOnce([{ ID: 7, KIND: 'retire', CREATED_AT: new Date(), CONFIRMED_AT: null, CNT: 2 }])
            .mockResolvedValueOnce([{ KI: 'KI-1' }, { KI: 'KI-2' }])
            .mockResolvedValueOnce([{ CNT: 1 }]); // годен только один — второй успел смениться
        const result = await service.confirmBatch(7);
        expect(result).toEqual({ confirmed: 1, skipped: 1, already: false });
        const update = execute.mock.calls.find(([sql]) => sql.includes('UPDATE MARKCODES'));
        expect(update[0]).toContain('SET CHZ_SENT_AT = CURRENT_TIMESTAMP');
        expect(update[0]).toContain('m.STATUS = 6 AND m.RETIRE_REASON = 1');
        const close = execute.mock.calls.find(([sql]) => sql.includes('UPDATE CHZ_BATCH'));
        // номер документа из ЛК не передан — DOC_UUID не трогаем (COALESCE с null)
        expect(close[1]).toEqual([null, 7]);
        expect(commit).toHaveBeenCalled();
    });

    it('confirmBatch с номером документа из ЛК ЧЗ — номер сохраняется в пачке', async () => {
        query
            .mockResolvedValueOnce([{ ID: 7, KIND: 'retire', CREATED_AT: new Date(), CONFIRMED_AT: null, CNT: 1 }])
            .mockResolvedValueOnce([{ KI: 'KI-1' }])
            .mockResolvedValueOnce([{ CNT: 1 }]);
        await service.confirmBatch(7, '  2978ecc8-4f63-4ab4-b0d6-05f444bd0f44  ');
        const close = execute.mock.calls.find(([sql]) => sql.includes('UPDATE CHZ_BATCH'));
        expect(close[0]).toContain('DOC_UUID = COALESCE(?, DOC_UUID)');
        expect(close[1]).toEqual(['2978ecc8-4f63-4ab4-b0d6-05f444bd0f44', 7]);
    });

    it('confirmBatch(return): снимает отметку — SET CHZ_SENT_AT = NULL по гварду возврата', async () => {
        query
            .mockResolvedValueOnce([{ ID: 8, KIND: 'return', CREATED_AT: new Date(), CONFIRMED_AT: null, CNT: 1 }])
            .mockResolvedValueOnce([{ KI: 'KI-1' }])
            .mockResolvedValueOnce([{ CNT: 1 }]);
        const result = await service.confirmBatch(8);
        expect(result).toEqual({ confirmed: 1, skipped: 0, already: false });
        const update = execute.mock.calls.find(([sql]) => sql.includes('UPDATE MARKCODES'));
        expect(update[0]).toContain('SET CHZ_SENT_AT = NULL');
        expect(update[0]).toContain('m.STATUS = 5 AND m.CHZ_SENT_AT IS NOT NULL');
    });

    it('confirmBatch: повторное подтверждение — тихий no-op', async () => {
        query.mockResolvedValueOnce([{ ID: 7, KIND: 'retire', CREATED_AT: new Date(), CONFIRMED_AT: new Date(), CNT: 2 }]);
        expect(await service.confirmBatch(7)).toEqual({ confirmed: 0, skipped: 0, already: true });
        expect(execute).not.toHaveBeenCalled();
    });

    it('confirmBatch: пачки нет → null', async () => {
        query.mockResolvedValueOnce([]);
        expect(await service.confirmBatch(99)).toBeNull();
    });

    it('pending(retire_upd): тот же вывод, но TT=1 — по УПД, а не по продаже маркетплейса', async () => {
        query.mockResolvedValueOnce([]);
        await service.pending('retire_upd');
        expect(query.mock.calls[0][0]).toContain(
            'm.STATUS = 6 AND m.RETIRE_REASON = 1 AND m.TRANSFER_TYPE = 1 AND m.CHZ_SENT_AT IS NULL',
        );
    });

    it('pendingDocs: группировка по УПД, цена берётся из строки документа', async () => {
        query.mockResolvedValueOnce([
            { SFCODE: 97542, NSF: 6558, DATA: null, SHORTNAME: '  ООО Ромашка ', CNT: 2, SINCE: null },
        ]);
        const docs = await service.pendingDocs();
        const sql = query.mock.calls[0][0];
        expect(sql).toContain('GROUP BY sf.SFCODE');
        expect(sql).toContain('m.TRANSFER_TYPE = 1');
        expect(docs).toEqual([
            { sfcode: 97542, nsf: 6558, date: null, buyer: 'ООО Ромашка', cnt: 2, since: null },
        ]);
    });

    it('createDocBatch: снимок кодов ОДНОЙ УПД, в пачку пишется её SFCODE', async () => {
        query
            .mockResolvedValueOnce([{ KI: 'KI-1', GOODSCODE: 1, PRICE: 100, NS: 1, PRIM: 'p', SINCE: null }])
            .mockResolvedValueOnce([{ ID: 9 }]);
        const batch = await service.createDocBatch(97542);
        expect(batch).toEqual({ id: 9, codes: expect.any(Array) });
        expect(query.mock.calls[0][1]).toEqual([97542]); // отбор только по этому документу
        expect(execute.mock.calls[0]).toEqual([
            'INSERT INTO CHZ_BATCH (ID, KIND, CNT, SFCODE) VALUES (?, ?, ?, ?)',
            [9, 'retire_upd', 1, 97542],
            false,
        ]);
    });

    it('createDocBatch: по документу выводить нечего → null, пачки нет', async () => {
        query.mockResolvedValueOnce([]);
        expect(await service.createDocBatch(97542)).toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('confirmBatch(retire_upd): ставит отметку передачи, как и обычный вывод', async () => {
        query
            .mockResolvedValueOnce([
                { ID: 5, KIND: 'retire_upd', CREATED_AT: new Date(), CONFIRMED_AT: null, CNT: 1, SFCODE: 97542, NSF: 6558, DATA: null },
            ])
            .mockResolvedValueOnce([{ KI: 'KI-1' }])
            .mockResolvedValueOnce([{ CNT: 1 }]);
        const res = await service.confirmBatch(5);
        expect(res).toEqual({ confirmed: 1, skipped: 0, already: false });
        expect(execute.mock.calls[0][0]).toContain('SET CHZ_SENT_AT = CURRENT_TIMESTAMP');
        expect(execute.mock.calls[0][0]).toContain('m.TRANSFER_TYPE = 1');
    });
});
