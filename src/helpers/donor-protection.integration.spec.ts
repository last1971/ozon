import * as Firebird from 'node-firebird';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';
import { FirebirdTransaction } from 'ts-firebird';
import { sellerReturnExistsSql, donorPartyCoverageSql } from './donor-protection.sql';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';

// Optional Firebird integration: FB_DONOR_TEST_DATABASE/HOST/USER/PASSWORD.
// Requires FB_DONOR_TEST_READ_ONLY=true. All test data live in SELECT-only CTEs;
// a READ ONLY transaction prohibits changes to real tables. CI without a DB skips this suite.
const str = (v) =>
    v == null ? 'CAST(NULL AS VARCHAR(100))' : "CAST('" + v.replaceAll("'", "''") + "' AS VARCHAR(100))";
const num = (v) => (v == null ? 'CAST(NULL AS INTEGER)' : String(v));
const stamp = (n) =>
    n == null ? 'CAST(NULL AS TIMESTAMP)' : `CAST('2026-01-01 00:00:${String(n).padStart(2, '0')}' AS TIMESTAMP)`;
const evt = (state, t = 1, extra = {}) => ({ state, t, id: 'return-1', first: 1, service: 'WB', ...extra });
const routes: [string, boolean, any[]][] = [
    ['no returns', false, []],
    ['moving to seller', true, [evt('MovingToSeller')]],
    ['at seller return point', true, [evt('ArrivedAtReturnPlace')]],
    ['received by seller', true, [evt('ReceivedBySeller')]],
    ['at marketplace only', false, [evt('ReturnedToOzon')]],
    ['route changed on same return', false, [evt('MovingToSeller', 1), evt('ReturnedToOzon', 2)]],
    ['old marketplace observation cannot override seller', true, [evt('MovingToSeller', 2), evt('ReturnedToOzon', 1)]],
    ['return reentered old state (FIRST_SEEN unchanged)', true, [evt('MovingToSeller', 3), evt('ReturnedToOzon', 2)]],
    [
        'different return cannot cancel seller return',
        true,
        [evt('MovingToSeller', 1), evt('ReturnedToOzon', 2, { id: 'return-2' })],
    ],
    ['equal timestamps remain blocked', true, [evt('MovingToSeller', 2), evt('ReturnedToOzon', 2)]],
    [
        'new unknown observation remains blocked',
        true,
        [evt('MovingToSeller', 1), evt('ReturnedToOzon', 2), evt('WaitingShipment', 3)],
    ],
    [
        'new claim observation does not prove marketplace location',
        true,
        [evt('MovingToSeller', 1), evt('ReturnedToOzon', 2), evt('Rejected', 3)],
    ],
    ['Ozon seller return blocked', true, [evt('ArrivedAtReturnPlace', 1, { service: 'OZON' })]],
    [
        'Ozon route changed on same return',
        false,
        [evt('ReceivedBySeller', 1, { service: 'OZON' }), evt('ReturnedToOzon', 2, { service: 'OZON' })],
    ],
    [
        'different service cannot cancel return',
        true,
        [evt('ReceivedBySeller', 1), evt('ReturnedToOzon', 2, { service: 'OZON' })],
    ],
    [
        'legacy missing LAST_SEEN uses FIRST_SEEN',
        false,
        [evt('MovingToSeller', null, { first: 1 }), evt('ReturnedToOzon', null, { first: 2 })],
    ],
];
const union = (rows) => rows.join(' UNION ALL ');
function routeSql() {
    const events = routes.flatMap(([, , es], i) =>
        es.map(
            (e) =>
                `SELECT ${str(e.service)},${str('RETURN')},${str(e.id)},${str('TEST-' + i)},${str(e.state)},${stamp(e.first)},${stamp(e.t)} FROM RDB$DATABASE`,
        ),
    );
    const invoices = routes.map((c, i) => `SELECT ${i},${str('TEST-' + i + ' отмена WBFBO')} FROM RDB$DATABASE`);
    return `WITH TEST_EVENTS(SERVICE,KIND,EXT_ID,POSTING,STATE,FIRST_SEEN,LAST_SEEN) AS (${union(events)}), TEST_INVOICES(CASE_ID,PRIM) AS (${union(invoices)}) SELECT s.CASE_ID,CASE WHEN ${sellerReturnExistsSql('s', 'TEST_EVENTS')} THEN 1 ELSE 0 END BLOCKED FROM TEST_INVOICES s ORDER BY s.CASE_ID`;
}
// All rows below are CTE fixtures. No real incoming parties, marks or picks are written.
const party = (id, ss = 0, good = 4, type = 0, pick = null) => ({ id, ss, good, type, pick });
const mark = (rpc, pmi, qty = 1) => ({ rpc, pmi, qty });
const f = (pmi, out, qty) => ({ pmi, out, qty });
const scenarios: any[] = [
    {
        name: 'two parties covered on both invoices',
        blocked: false,
        marks: [mark(100, 10), mark(200, 20)],
        parties: [party(10), party(20), party(11, 0, 4, 1, 1), party(21, 0, 4, 1, 2)],
        fifo: [f(10, 11, 1), f(20, 21, 1)],
    },
    {
        name: 'same totals but parties swapped',
        blocked: true,
        marks: [mark(100, 10), mark(200, 20)],
        parties: [party(10), party(20), party(11, 0, 4, 1, 1), party(21, 0, 4, 1, 2)],
        fifo: [f(20, 11, 1), f(10, 21, 1)],
    },
    {
        name: 'source code lost its party',
        blocked: true,
        marks: [mark(100, 10), mark(200, 20)],
        parties: [party(10), party(20), party(11, 0, 4, 1, 1), party(21, 0, 4, 1, 2)],
        fifo: [f(20, 11, 1), f(20, 21, 1)],
    },
    {
        name: 'target code has wrong party',
        blocked: true,
        marks: [mark(100, 10), mark(200, 20)],
        parties: [party(10), party(20), party(11, 0, 4, 1, 1), party(21, 0, 4, 1, 2)],
        fifo: [f(10, 11, 1), f(10, 21, 1)],
    },
    {
        name: 'code without incoming party',
        blocked: true,
        marks: [mark(100, null)],
        parties: [party(10), party(11, 0, 4, 1, 1)],
        fifo: [f(10, 11, 1)],
    },
    {
        name: 'party for another product',
        blocked: true,
        marks: [mark(100, 10)],
        parties: [party(10, 0, 5), party(11, 0, 4, 1, 1)],
        fifo: [f(10, 11, 1)],
    },
    {
        name: 'quantity code undercovered',
        blocked: true,
        marks: [mark(100, 10, 5)],
        parties: [party(10), party(11, 0, 4, 1, 1)],
        fifo: [f(10, 11, 4)],
    },
    {
        name: 'same party on two invoices requires each invoice coverage',
        blocked: true,
        marks: [mark(100, 10), mark(200, 10)],
        parties: [party(10), party(11, 0, 4, 1, 1), party(21, 0, 4, 1, 2)],
        fifo: [f(10, 11, 2), f(10, 21, 0)],
    },
    {
        name: 'shop party cannot be covered with warehouse pick',
        blocked: true,
        marks: [mark(100, 10)],
        parties: [party(10, 1), party(11, 0, 4, 1, 1)],
        fifo: [f(10, 11, 1)],
    },
    {
        name: 'mixed shop and warehouse parties covered separately',
        blocked: false,
        marks: [mark(100, 10), mark(100, 30), mark(200, 20)],
        parties: [
            party(10),
            party(30, 1),
            party(20),
            party(11, 0, 4, 1, 1),
            party(31, 1, 4, 1, 1),
            party(21, 0, 4, 1, 2),
        ],
        fifo: [f(10, 11, 1), f(30, 31, 1), f(20, 21, 1)],
    },
];
function coverageSql(c) {
    const ms = c.marks.map(
        (m) =>
            `SELECT ${num(m.rpc)},${num(m.pmi)},4,${num(m.qty)},CAST(NULL AS INTEGER),CAST(NULL AS INTEGER),CAST(NULL AS INTEGER),CAST(NULL AS INTEGER),CAST(NULL AS INTEGER) FROM RDB$DATABASE`,
    );
    const ps = c.parties.map(
        (p) => `SELECT ${num(p.id)},${num(p.good)},${num(p.type)},${num(p.ss)},${num(p.pick)} FROM RDB$DATABASE`,
    );
    const picks = ['SELECT 1,100 FROM RDB$DATABASE', 'SELECT 2,200 FROM RDB$DATABASE'];
    const fs = c.fifo.map((f) => `SELECT ${f.pmi},${f.out},${f.qty} FROM RDB$DATABASE`);
    return `WITH TM(REALPRICECODE,PR_META_IN_ID,GOODSCODE,QUANTITY,REALPRICEFCODE,SHOPLOGCODE,SPISID,SPISSKLADCODE,SPISSHOPCODE) AS (${union(ms)}), TP(ID,GOODSCODE,P_R,S_S,PODBPOSCODE) AS (${union(ps)}), TB(PODBPOSCODE,REALPRICECODE) AS (${union(picks)}), TF(PR_META_IN_ID,PR_META_OUT_ID,QUAN) AS (${union(fs)}) ${donorPartyCoverageSql('TM', 'TP', 'TB', 'TF')}`;
}

const integration = process.env.FB_DONOR_TEST_DATABASE ? describe : describe.skip;
integration('Donor protection SQL on Firebird (read only)', () => {
    let db: any;
    let transaction: any;
    let routeResults: any[];
    let query: (sql: string, args?: any[]) => Promise<any[]>;

    beforeAll(async () => {
        if (process.env.FB_DONOR_TEST_READ_ONLY !== 'true') throw new Error('READ ONLY opt-in is required');
        db = await promisify(Firebird.attach)({
            host: process.env.FB_DONOR_TEST_HOST || '127.0.0.1',
            port: Number(process.env.FB_DONOR_TEST_PORT || 3050),
            database: process.env.FB_DONOR_TEST_DATABASE,
            user: process.env.FB_DONOR_TEST_USER,
            password: process.env.FB_DONOR_TEST_PASSWORD,
            role: process.env.FB_DONOR_TEST_ROLE || 'DBUSER',
            encoding: 'UTF8',
        } as any);
        transaction = await promisify(db.transaction).call(db, Firebird.ISOLATION_READ_COMMITTED_READ_ONLY);
        query = async (sql, args = []) => promisify(transaction.query).call(transaction, sql, args);
        routeResults = await query(routeSql());
    }, 30000);

    afterAll(async () => {
        if (transaction) await promisify(transaction.rollback).call(transaction);
        if (db) db.detach();
    });

    it.each(routes.map(([name, blocked], i) => ({ name, blocked, i })))('$name', ({ blocked, i }) => {
        const row = routeResults.find((r) => r.CASE_ID === i);
        expect(row).toBeDefined();
        expect(Boolean(row.BLOCKED)).toBe(blocked);
    });

    it.each(scenarios)('$name', async (scenario) => {
        let first = true;
        const t = {
            query: async (_sql: string, args: any[]) => {
                // Supply the already locked pickup snapshot. Execute the real postcondition SQL
                // against a synthetic post-transfer state, without executing a real stock mutation.
                if (first) {
                    first = false;
                    return [{ REALPRICECODE: 100, PICKED: 10, BOUND: 0, RETURNING: 0 }];
                }
                return query(coverageSql(scenario), args);
            },
            execute: jest.fn().mockResolvedValue([]),
        } as unknown as FirebirdTransaction;
        const config = {
            get: (key: string, fallback: any) =>
                key === 'MARK_CODES_ENABLED' ? true : key === 'STORAGE_TYPE' ? 'SKLAD' : fallback,
        };
        const service = new Trade2006InvoiceService(null, config as ConfigService, null, null);
        const operation = service.migratePodbpos(1, 2, 200, '4', 1, t);
        if (scenario.blocked) await expect(operation).rejects.toThrow();
        else await expect(operation).resolves.toBeUndefined();
    });
});
