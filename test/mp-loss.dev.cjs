/** Ручная интеграционная проверка существующих dev-баз, только 127.0.0.1.
 * Запуск после npm run build: node test/mp-loss.dev.cjs
 * Требует применённого SQL схемы и отсутствия снимка OZON в MP_LOSS_STATE.
 * Контрольные изменения OZON_PERC откатываются, LOSS_TEST_A/B удаляются в finally.
 * Перенос имеющихся датированных dev-строк выполняется отдельной транзакцией.
 * Прод-адрес из .env намеренно не используется; реквизиты не выводятся.
 */
const fs = require('fs');
const { createRequire } = require('module');
const path = require('path');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const fb = req('node-firebird');
const dotenv = req('dotenv');
const call = (o, m, ...a) => new Promise((res, rej) => o[m](...a, (e, r) => (e ? rej(e) : res(r))));
function options(name) {
    if (!['opt', 'magazin'].includes(name)) throw Error('Только существующие dev-базы');
    const e = dotenv.parse(fs.readFileSync(root + '/' + (name === 'opt' ? '.env' : '.env.magazin')));
    return {
        host: '127.0.0.1',
        port: 3050,
        database: '/var/lib/firebird/2.5/data/' + name + '.fdb',
        user: e.FB_USER || 'SYSDBA',
        password: e.FB_PASS,
        encoding: e.FB_ENCD || 'UTF8',
        retryConnectionInterval: 1000,
    };
}
const assert = require('node:assert/strict');
const { Trade2006GoodService } = req('./dist/trade2006.good/trade2006.good.service');
const { ConfigService } = req('@nestjs/config');
const { calculateOzonPrices } = req('./dist/helpers/price/ozon.pricing');
const text = fs.readFileSync(path.join(root, 'sql/2026-11-06_mp_loss_stats_migrate.sql'), 'utf8');
const sql = text.slice(text.indexOf('EXECUTE BLOCK AS'), text.indexOf('END^') + 3);
const dates = ['2026-10-15T12:34:56.000', '2026-11-01T05:38:00.000', '2026-11-02T05:38:00.000'];
async function verifyMigration() {
    for (const name of ['opt', 'magazin']) {
        let db, t;
        try {
            db = await call(fb, 'attach', options(name));
            t = await call(db, 'transaction', fb.ISOLATION_REPEATABLE_READ);
            assert.equal((await call(t, 'query', "SELECT COUNT(*) N FROM MP_LOSS_STATE WHERE SERVICE='OZON'"))[0].N, 0);
            const keys = await call(
                t,
                'query',
                'SELECT FIRST 3 GOODSCODE, PIECES FROM OZON_PERC ORDER BY GOODSCODE,PIECES',
            );
            assert.equal(keys.length, 3);
            // Все контрольные изменения исходных строк живут только в этой откатываемой транзакции.
            for (let i = 0; i < 3; i++)
                await call(
                    t,
                    'query',
                    'UPDATE OZON_PERC SET RETURN_PERC=?, RETURN_PERC_AT=? WHERE GOODSCODE=? AND PIECES=?',
                    [[0, 0.333333, 1][i], new Date(dates[i]), keys[i].GOODSCODE, keys[i].PIECES],
                );
            const before = await call(
                t,
                'query',
                'SELECT GOODSCODE, PIECES, RETURN_PERC, RETURN_PERC_AT FROM OZON_PERC WHERE RETURN_PERC_AT IS NOT NULL ORDER BY GOODSCODE,PIECES',
            );
            await call(t, 'query', sql);
            const copied = await call(
                t,
                'query',
                "SELECT GOODSCODE, PIECES, APPLIED_RETURN_RATE AS RETURN_PERC, CALCULATED_AT AS RETURN_PERC_AT FROM MP_LOSS_STATS WHERE SERVICE='OZON' ORDER BY GOODSCODE,PIECES",
            );
            assert.deepEqual(copied, before);
            // Реальный getPerc читает новый JOIN; старые поля затем меняем, чтобы исключить скрытый fallback.
            const goods = new Trade2006GoodService(
                {
                    getTransaction: () => {
                        throw Error('Должна использоваться переданная транзакция');
                    },
                },
                new ConfigService({ SUM_PACK: 16 }),
                null,
                null,
                null,
            );
            const current = await goods.getPerc([...new Set(before.map((r) => String(r.GOODSCODE)))], {
                query: async (query, params) => call(t, 'query', query, params),
            });
            for (const old of before)
                assert.equal(
                    current.find((r) => r.offer_id === old.GOODSCODE && r.pieces === old.PIECES).return_perc,
                    old.RETURN_PERC,
                );
            const band = { min: 0, max: null, minIncluded: true, maxIncluded: false };
            const input = {
                base: 100,
                baseSource: 'market',
                markups: { min: 20, normal: 40, max: 80 },
                minProfitRub: 20,
                minMarkupPercent: 10,
                acquiringRate: 0.025,
                advertisingPercent: 1,
                packing: 8,
                label: 4,
                handling: 10,
                taxPercent: 10,
                vatRate: 20,
                profitTaxRate: 20,
                schemes: [
                    {
                        scheme: 'fbs',
                        commissions: [
                            { ...band, max: 300, maxIncluded: true, rate: 0.23 },
                            { ...band, min: 300, minIncluded: false, rate: 0.47 },
                        ],
                        logistics: [
                            { ...band, max: 300, maxIncluded: true, amount: 35 },
                            { ...band, min: 300, minIncluded: false, amount: 117 },
                        ],
                        lastMile: 25,
                        firstMile: 10,
                        returnFlow: 60,
                    },
                ],
            };
            for (let i = 0; i < before.length; i++)
                assert.deepEqual(
                    calculateOzonPrices({ ...input, returnRate: before[i].RETURN_PERC }),
                    calculateOzonPrices({ ...input, returnRate: copied[i].RETURN_PERC }),
                );
            assert.equal(
                (
                    await call(
                        t,
                        'query',
                        'SELECT COUNT(*) N FROM MP_LOSS_STATS WHERE SOLD_UNITS IS NOT NULL OR DEFECT_RATE IS NOT NULL',
                    )
                )[0].N,
                0,
            );
            // Даже после изменения старого источника повторный запуск не затирает перенесённый снимок.
            await call(t, 'query', 'UPDATE OZON_PERC SET RETURN_PERC=0.9 WHERE GOODSCODE=? AND PIECES=?', [
                keys[0].GOODSCODE,
                keys[0].PIECES,
            ]);
            await call(t, 'query', sql);
            const stillCurrent = await goods.getPerc([String(keys[0].GOODSCODE)], {
                query: async (query, params) => call(t, 'query', query, params),
            });
            assert.equal(stillCurrent.find((r) => r.pieces === keys[0].PIECES).return_perc, before[0].RETURN_PERC);
            assert.deepEqual(
                await call(
                    t,
                    'query',
                    "SELECT GOODSCODE, PIECES, APPLIED_RETURN_RATE AS RETURN_PERC, CALCULATED_AT AS RETURN_PERC_AT FROM MP_LOSS_STATS WHERE SERVICE='OZON' ORDER BY GOODSCODE,PIECES",
                ),
                copied,
            );
            await call(t, 'rollback');
            t = null;
            console.log(name + ': перенос 0%, 33.3333%, 100%, фасовок и дат; повторный запуск; откат — успешно');
            t = await call(db, 'transaction', fb.ISOLATION_REPEATABLE_READ);
            // Датированная строка без процента не переносится как ноль: весь блок откатывается.
            await call(
                t,
                'query',
                'UPDATE OZON_PERC SET RETURN_PERC=NULL, RETURN_PERC_AT=? WHERE GOODSCODE=? AND PIECES=?',
                [new Date(dates[0]), keys[0].GOODSCODE, keys[0].PIECES],
            );
            await assert.rejects(() => call(t, 'query', sql));
            assert.equal((await call(t, 'query', "SELECT COUNT(*) N FROM MP_LOSS_STATE WHERE SERVICE='OZON'"))[0].N, 0);
            await call(t, 'rollback');
            t = await call(db, 'transaction', fb.ISOLATION_REPEATABLE_READ);
            // Настоящий перенос имеющихся dev-данных (даты сейчас отсутствуют, переносить нечего).
            const count = (
                await call(t, 'query', 'SELECT COUNT(*) N FROM OZON_PERC WHERE RETURN_PERC_AT IS NOT NULL')
            )[0].N;
            await call(t, 'query', sql);
            assert.equal(
                (await call(t, 'query', "SELECT COUNT(*) N FROM MP_LOSS_STATS WHERE SERVICE='OZON'"))[0].N,
                count,
            );
            await call(t, 'commit');
            t = null;
            console.log(name + ': фактически перенесено ' + count + ' рассчитанных строк');
        } finally {
            if (t) await call(t, 'rollback').catch(() => {});
            if (db) db.detach();
        }
    }
}

const { FirebirdPool } = req('ts-firebird');
const { LossStatsStore } = req('./dist/marketplace-loss/loss-stats.store');
const { calculateLossRates, lossPeriod } = req('./dist/helpers/price/marketplace.loss.stats');
const row = (offerId, soldUnits, returnedUnits, writtenOffUnits) => ({
    offerId,
    soldUnits,
    returnedUnits,
    writtenOffUnits,
    ...calculateLossRates({ soldUnits, returnedUnits, writtenOffUnits }),
});
const snapshot = (service, seconds, rows = [row('123-4', 3, 3, 1)]) => {
    const calculatedAt = new Date(Date.UTC(2026, 10, 6, 10, 0, seconds));
    return { service, preliminary: true, period: lossPeriod(calculatedAt), calculatedAt, rows };
};
async function verifyStore() {
    for (const name of ['opt', 'magazin']) {
        const pool = new FirebirdPool(4, options(name));
        const store = new LossStatsStore(pool);
        let owned = false;
        try {
            assert.equal(await store.read('LOSS_TEST_A'), null);
            assert.equal(await store.read('LOSS_TEST_B'), null);
            owned = true;
            const first = snapshot('LOSS_TEST_A', 0);
            await store.replace(first);
            let saved = await store.read('LOSS_TEST_A');
            assert.equal(saved.rows[0].returnRate, 1);
            assert.equal(saved.rows[0].defectRate, 1 / 3);
            const original = structuredClone(saved);
            await store.replace(snapshot('LOSS_TEST_B', 0));
            const other = await store.read('LOSS_TEST_B');
            await assert.rejects(
                () =>
                    store.replace(snapshot('LOSS_TEST_A', 1, [row('456', 7, 0, 0)]), {
                        beforeCommit: async () => {
                            throw Error('контрольный отказ до commit');
                        },
                    }),
                /контрольный отказ/,
            );
            assert.deepEqual(await store.read('LOSS_TEST_A'), original);
            await assert.rejects(() => store.replace(snapshot('LOSS_TEST_A', 0)), /новый снимок/);
            assert.deepEqual(await store.read('LOSS_TEST_A'), original);
            // Два независимых соединения пишут одну площадку. Новый результат коммитится первым.
            let release, entered;
            const gate = new Promise((r) => (release = r));
            const ready = new Promise((r) => (entered = r));
            const newer = store.replace(snapshot('LOSS_TEST_A', 3, [row('123', 10, 2, 1)]), {
                beforeCommit: async () => {
                    entered();
                    await gate;
                },
            });
            await ready;
            const older = store.replace(snapshot('LOSS_TEST_A', 2, [row('123', 1, 1, 1)]));
            const resultsPromise = Promise.allSettled([newer, older]);
            await new Promise((r) => setTimeout(r, 100));
            release();
            const results = await resultsPromise;
            assert.equal(results[0].status, 'fulfilled');
            assert.equal(results[1].status, 'rejected');
            assert.equal((await store.read('LOSS_TEST_A')).rows[0].returnRate, 0.2);
            assert.deepEqual(await store.read('LOSS_TEST_B'), other);
            await store.replace(snapshot('LOSS_TEST_A', 4, [row('123', 0, 1, 1), row('456', 1, 2, 3)]));
            const exceptional = await store.read('LOSS_TEST_A');
            assert.equal(exceptional.rows[0].state, 'NO_SALES');
            assert.equal(exceptional.rows[0].returnRate, null);
            assert.equal(exceptional.rows[1].state, 'REVIEW');
            await store.replace(snapshot('LOSS_TEST_A', 5, []));
            assert.deepEqual((await store.read('LOSS_TEST_A')).rows, []);
            console.log(
                name +
                    ': реальная запись/чтение, rollback, конкуренция, изоляция площадок, отсутствие продаж, >100%, пустой снимок — успешно',
            );
        } finally {
            if (owned) {
                const t = await pool.getTransaction();
                try {
                    await t.execute(
                        "DELETE FROM MP_LOSS_STATS WHERE SERVICE IN ('LOSS_TEST_A','LOSS_TEST_B')",
                        [],
                        false,
                    );
                    await t.execute(
                        "DELETE FROM MP_LOSS_STATE WHERE SERVICE IN ('LOSS_TEST_A','LOSS_TEST_B')",
                        [],
                        false,
                    );
                    await t.commit(true);
                } catch (e) {
                    await t.rollback(true);
                    throw e;
                }
            }
            pool.destroy();
        }
    }
}

async function verifyOzonChain() {
    const { OzonReturnService } = req('./dist/trade2006.accrual/ozon.return.service');
    const { OzonReturnStore } = req('./dist/trade2006.accrual/ozon.return.store');
    const { JobService } = req('./dist/job/job.service');
    const { buildOzonReturnSnapshot } = req('./dist/helpers/price/ozon.return.snapshot');
    const { lossOfferKey } = req('./dist/helpers/price/marketplace.loss.stats');
    const { Logger } = req('@nestjs/common');
    Logger.overrideLogger(false);
    for (const name of ['opt', 'magazin']) {
        const pool = new FirebirdPool(4, options(name));
        const store = new OzonReturnStore(pool);
        let owned = false;
        const readSettings = async () => {
            const t = await pool.getTransaction(fb.ISOLATION_READ_COMMITTED_READ_ONLY);
            try {
                return await t.query('SELECT * FROM OZON_PERC ORDER BY GOODSCODE,PIECES', [], false);
            } finally {
                await t.rollback(true);
            }
        };
        try {
            assert.equal(await store.read('OZON'), null);
            owned = true;
            const before = await readSettings();
            const keys = before.slice(0, 3);
            assert.equal(keys.length, 3);
            const offers = keys.map((r) => lossOfferKey(`${r.GOODSCODE}-${r.PIECES}`));
            const catalog = offers.map((sku, i) => ({ sku, typeId: 10, marketSku: 10 + i, cabinetSku: 100 + i }));
            const report = {
                issues: [],
                rows: offers.map((offerId, i) => ({
                    offerId,
                    soldUnits: [2, 8, 0][i],
                    paidReturnUnits: [1, 1, 0][i],
                    returnPerc: [0.5, 0.125, 0][i],
                })),
            };
            const products = { listAllOfferIds: async () => offers, infoList: async () => catalog };
            const config = new ConfigService({
                OZON_RETURN_MIN_SALES: 5,
                OZON_RETURN_PERC_DEFAULT: 0.07,
                SUM_PACK: 16,
            });
            const service = new OzonReturnService(
                config,
                products,
                { preview: async () => report },
                store,
                { listRecordedWriteOffs: async () => [] },
                new JobService(),
            );
            const done = await service.recalculate(new Date('2026-11-06T12:00:00Z'));
            const actual = await store.read('OZON');
            assert.equal(actual.rows.length, done.rows);
            const oldValues = new Map(
                buildOzonReturnSnapshot(report, catalog, 5, 0.07).map((r) => [
                    lossOfferKey(`${r.goodscode}-${r.pieces}`),
                    Number(r.returnPerc.toFixed(6)),
                ]),
            );
            for (const r of actual.rows) assert.equal(r.appliedReturnRate, oldValues.get(r.offerId) ?? 0.07);
            assert.equal(actual.rows.find((r) => r.offerId === offers[0]).returnRate, 0.5);
            assert.equal(actual.rows.find((r) => r.offerId === offers[0]).appliedReturnRate, 0.2);
            assert.equal(actual.rows.find((r) => r.offerId === offers[2]).returnRate, null);
            const goods = new Trade2006GoodService(pool, config, null, null, null);
            const percents = await goods.getPerc([...new Set(keys.map((k) => String(k.GOODSCODE)))]);
            const band = { min: 0, max: null, minIncluded: true, maxIncluded: false };
            const input = {
                base: 100,
                baseSource: 'market',
                markups: { min: 20, normal: 40, max: 80 },
                minProfitRub: 20,
                minMarkupPercent: 10,
                acquiringRate: 0.025,
                advertisingPercent: 1,
                packing: 8,
                label: 4,
                handling: 10,
                taxPercent: 10,
                vatRate: 20,
                profitTaxRate: 20,
                schemes: [
                    {
                        scheme: 'fbs',
                        commissions: [
                            { ...band, max: 300, maxIncluded: true, rate: 0.23 },
                            { ...band, min: 300, minIncluded: false, rate: 0.47 },
                        ],
                        logistics: [
                            { ...band, max: 300, maxIncluded: true, amount: 35 },
                            { ...band, min: 300, minIncluded: false, amount: 117 },
                        ],
                        lastMile: 25,
                        firstMile: 10,
                        returnFlow: 60,
                    },
                ],
            };
            for (const k of keys) {
                const offer = lossOfferKey(`${k.GOODSCODE}-${k.PIECES}`);
                const current = percents.find((p) => p.offer_id === k.GOODSCODE && p.pieces === k.PIECES);
                assert.deepEqual(
                    calculateOzonPrices({ ...input, returnRate: current.return_perc }),
                    calculateOzonPrices({ ...input, returnRate: oldValues.get(offer) }),
                );
            }
            assert.deepEqual(await readSettings(), before);
            console.log(
                name + ': полная цепочка Ozon, ' + done.rows + ' фасовок; политика/цены прежние, OZON_PERC не изменён',
            );
        } finally {
            if (owned) {
                const t = await pool.getTransaction();
                try {
                    await t.execute("DELETE FROM MP_LOSS_STATS WHERE SERVICE='OZON'", [], false);
                    await t.execute("DELETE FROM MP_LOSS_STATE WHERE SERVICE='OZON'", [], false);
                    await t.commit(true);
                } catch (e) {
                    await t.rollback(true);
                    throw e;
                }
            }
            pool.destroy();
        }
    }
}

(async () => {
    await verifyMigration();
    await verifyStore();
    await verifyOzonChain();
})().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
