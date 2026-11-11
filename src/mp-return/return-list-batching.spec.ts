import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { Trade2006ReturnStockService } from '../trade2006.invoice/trade2006.return-stock.service';
import { MpReturnAcceptStore } from '../mp-event/mp-return-accept.store';
import { MpReturnService } from './mp-return.service';
import { ReturnCardBuilder } from './return-card.builder';
import { returnRowStatus } from './assess-return-line';
import { candidatePostings, resolveCandidates, ReturnCandidate } from './return-candidate';
import { WbReturnSource } from './sources/wb.return.source';
import { ISOLATION_READ_COMMITTED_READ_ONLY } from 'node-firebird';

/** Реальные SQL-адаптеры и построитель, без сети. Повторяет объём розницы: 100 строк, 88 обработаны. */
function fixture(processed = 88) {
    const invoices = Array.from({ length: 100 }, (_, i) => ({
        SCODE: i + 1,
        NS: 1000 + i,
        PRIM: `${1000000000 + i}${i % 2 ? ' отмена' : ''}`,
        STATUS: 0,
        DATA: new Date('2026-11-01T00:00:00Z'),
    }));
    const items = invoices.map((s, i) => ({
        SCODE: s.SCODE,
        REALPRICECODE: 200 + i,
        GOODSCODE: 543000,
        NAME: 'Товар',
        QUAN: i % 2 ? 3 : 1,
        PIECES: i % 2 ? 3 : null,
        PODBPOSCODE: 300 + i,
        PICKED: i % 2 ? 3 : 1,
        NEED: 0,
        SHIPPED: 0,
    }));
    const records = invoices.slice(0, processed).map((s, i) => ({
        EXT_ID: String(i),
        SERVICE: 'WB',
        DECISION: i % 3 ? 'RETURN' : 'PROBLEM',
        CREATED_AT_TEXT: '2026-11-05 12:00:00.0000',
        CREATED_AT: new Date('2026-11-05'),
        ID: i + 1,
        SPIS_CODE: i % 3 === 1 ? i + 1 : null,
    }));
    const query = jest.fn(async (sql: string, args: any[] = []) => {
        if (sql.includes('FROM MP_RETURN_ACCEPT')) return records.filter((r) => args.slice(1).includes(r.EXT_ID));
        if (sql.includes('FROM S WHERE'))
            return invoices.filter((s) => args.some((p) => s.PRIM === p || s.PRIM.startsWith(p)));
        if (sql.includes('FROM REALPRICE r')) return items.filter((r) => args.includes(r.SCODE));
        if (sql.includes('FROM MARKCODES'))
            return items
                .filter((r) => args.includes(r.REALPRICECODE) && r.SCODE % 2 === 0)
                .map((r) => ({
                    REALPRICECODE: r.REALPRICECODE,
                    KI: `code-${r.SCODE}`,
                    QUANTITY: 3,
                    STATUS: 5,
                    TRANSFER_TYPE: 0,
                }));
        throw new Error(`Unexpected SQL ${sql}`);
    });
    const t = { query, commit: jest.fn(async () => undefined), rollback: jest.fn(async () => undefined) };
    const pool = { getTransaction: jest.fn(async () => t) };
    const config = new ConfigService({ STORAGE_TYPE: 'SHOPSKLAD', MARK_CODES_ENABLED: true, SERVICES: ['wb'] });
    const inv = new Trade2006InvoiceService(pool as any, config, new EventEmitter2(), null);
    const stock = new Trade2006ReturnStockService(pool as any, config);
    const store = new MpReturnAcceptStore(pool as any);
    const builder = new ReturnCardBuilder(inv, stock, store);
    const source = new WbReturnSource(
        {
            rows: async () =>
                invoices.map((s, i) => ({
                    shkId: i,
                    orderId: 1000000000 + i,
                    srid: `srid-${i}`,
                    nmId: i,
                    status: 'Выдано',
                    completedDt: '2026-11-04T12:00:00',
                })),
        } as any,
        { getWbCardByNmId: (i: number) => ({ vendorCode: i % 2 ? '543000-3' : '543000', title: 'Товар' }) } as any,
        inv,
        config,
    );
    const service = new MpReturnService([source], inv, stock, builder, store, null, new EventEmitter2());
    return { service, source, inv, stock, store, builder, query, t, pool };
}

describe('Групповое чтение списка возвратов', () => {
    it('100 возвратов / 88 обработанных: четыре SQL вместо чтения карточек всех 100', async () => {
        const f = fixture();
        const rows = await f.service.list('WB', '2026-11-01', '2026-11-10');
        expect(rows).toHaveLength(12);
        expect(rows.map((r) => r.line.extId)).toEqual(Array.from({ length: 12 }, (_, i) => String(88 + i)));
        expect(f.query).toHaveBeenCalledTimes(4);
        expect(f.pool.getTransaction).toHaveBeenCalledTimes(1);
        expect(f.pool.getTransaction).toHaveBeenCalledWith(ISOLATION_READ_COMMITTED_READ_ONLY);
        expect(f.t.commit).toHaveBeenCalledWith(true);
        expect(rows.some((r) => 'postingCandidates' in r.line)).toBe(false);

        // Сопоставление с прежним проходом: все карточки сначала, фильтр в самом конце.
        const candidates = await f.source.listReceived(new Date('2026-11-01'), new Date('2026-11-11'));
        const records = new Map(
            (
                await f.store.findMany(
                    'WB',
                    candidates.map((l) => l.extId),
                    f.t as any,
                )
            ).map((r) => [r.extId, r]),
        );
        const matches = await f.inv.findByPostings(candidatePostings(candidates), f.t as any);
        const previous = [];
        for (const line of resolveCandidates(candidates, matches)) {
            const card = await f.builder.build(line, f.t as any, records.get(line.extId) ?? null);
            previous.push({
                line,
                invoiceNumber: card.invoice?.number ?? null,
                goodsName: card.invoiceLine?.name ?? line.productName,
                quan: card.quan,
                status: returnRowStatus(card.accepted, card.blockers),
                blockers: card.blockers,
                warnings: card.warnings,
            });
        }
        expect(rows).toEqual(previous.filter((r) => r.status === 'pending' || r.status === 'blocked'));
    });

    it('показ всех возвращает принятые, проблемные и списанные со всеми прежними статусами', async () => {
        const f = fixture();
        const rows = await f.service.list('WB', '2026-11-01', '2026-11-10', false);
        expect(rows).toHaveLength(100);
        expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['problem', 'written-off', 'accepted', 'pending']));
        expect(f.query.mock.calls.filter(([sql]) => sql.includes('FROM S WHERE'))).toHaveLength(5); // 200 кандидатов / 40
        expect(f.query.mock.calls.filter(([sql]) => sql.includes('FROM REALPRICE r'))).toHaveLength(1);
        expect(f.query.mock.calls.filter(([sql]) => sql.includes('FROM MARKCODES'))).toHaveLength(1);
    });

    it('всё обработано: только журнал, без поиска счетов, товаров и марок', async () => {
        const f = fixture(100);
        expect(await f.service.list('WB', '2026-11-01', '2026-11-10')).toEqual([]);
        expect(f.query).toHaveBeenCalledTimes(1);
    });

    it('сбой чтения откатывает транзакцию и не выдаёт пустой успешный список', async () => {
        const f = fixture();
        f.query.mockRejectedValueOnce(new Error('read failed'));
        await expect(f.service.list('WB', '2026-11-01', '2026-11-10')).rejects.toThrow('read failed');
        expect(f.t.rollback).toHaveBeenCalledWith(true);
        expect(f.t.commit).not.toHaveBeenCalled();
    });

    it('FBS имеет приоритет над FBO; без обоих остаётся номер заказа; служебные поля убраны', () => {
        const candidate = {
            posting: '100',
            schema: null,
            postingCandidates: [
                { posting: '100', schema: 'FBS' },
                { posting: 'srid', schema: 'FBO' },
            ],
        } as ReturnCandidate;
        expect(
            resolveCandidates(
                [candidate],
                new Map([
                    ['100', {} as any],
                    ['srid', {} as any],
                ]),
            )[0],
        ).toEqual({ posting: '100', schema: 'FBS' });
        expect(resolveCandidates([candidate], new Map([['srid', {} as any]]))[0]).toEqual({
            posting: 'srid',
            schema: 'FBO',
        });
        expect(resolveCandidates([candidate], new Map())[0]).toEqual({ posting: '100', schema: null });
    });
});
