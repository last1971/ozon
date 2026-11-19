import { attachOzonBaseReceipts, OzonTransitionJournal } from './ozon-transition-journal';

function database() {
    let committed = new Map<string, { POSTING: string; PAYLOAD: string; HANDLED_AT: string | null }>();
    const calls: string[] = [];
    const key = (kind, id) => JSON.stringify([kind, id]);
    return {
        calls,
        async getTransaction() {
            const draft = structuredClone(committed);
            return {
                query: async (sql: string, args) => {
                    const [kind, id] = args;
                    calls.push(sql);
                    if (sql.includes("KIND = 'PRICE_BASE'") && sql.includes('EXT_ID IN (')) {
                        return [...draft].flatMap(([rowKey, row]) => {
                            const [type, offer] = JSON.parse(rowKey);
                            if (type !== 'PRICE_BASE' || !args.includes(offer)) return [];
                            return [{ EXT_ID: offer, PAYLOAD_TEXT: row.PAYLOAD }];
                        });
                    }
                    if (sql.includes('EXT_ID IN (')) {
                        return [...draft].flatMap(([rowKey, row]) => {
                            const [type, offer] = JSON.parse(rowKey);
                            return type === kind && args.slice(1).includes(offer) ? [{ EXT_ID: offer, POSTING: row.POSTING }] : [];
                        });
                    }
                    if (sql.includes('SUBSTRING(PAYLOAD FROM CAST(?')) {
                        const [start, stream, offer, token] = args;
                        const row = draft.get(key(stream, offer));
                        if (!row || row.POSTING !== token || row.HANDLED_AT) return [];
                        return [{ PART: [...row.PAYLOAD].slice(start - 1, start - 1 + 4096).join('') }];
                    }
                    if (sql.includes('WITH LOCK')) {
                        const row = draft.get(key(kind, id));
                        return row ? [row] : [];
                    }
                    return [...draft].flatMap(([rowKey, row]) => {
                        const [type, offer] = JSON.parse(rowKey);
                        if (type !== kind || row.HANDLED_AT || (id !== undefined && offer !== id)) return [];
                        const chars = [...row.PAYLOAD];
                        return [{ EXT_ID: offer, POSTING: row.POSTING, PAYLOAD_LENGTH: chars.length, PART: chars.slice(0, 4096).join('') }];
                    });
                },
                execute: async (sql: string, args) => {
                    calls.push(sql);
                    if (sql.startsWith('UPDATE OR INSERT')) {
                        draft.set(key('PRICE_BASE', args[0]), { POSTING: '', PAYLOAD: args[1], HANDLED_AT: 'now' });
                    } else if (sql.startsWith('DELETE')) {
                        draft.delete(key('PRICE_BASE', args[0]));
                    } else if (sql.startsWith('INSERT')) {
                        const [kind, id, token, payload] = args;
                        if (draft.has(key(kind, id))) throw Error('violation of PRIMARY key');
                        draft.set(key(kind, id), { POSTING: token, PAYLOAD: payload, HANDLED_AT: null });
                    } else if (sql.includes('HANDLED_AT = NULL')) {
                        const [token, payload, kind, id] = args;
                        draft.set(key(kind, id), { POSTING: token, PAYLOAD: payload, HANDLED_AT: null });
                    } else {
                        const [token, kind, id] = args;
                        Object.assign(draft.get(key(kind, id)), { HANDLED_AT: 'now', POSTING: token });
                    }
                },
                commit: async () => { committed = draft; },
                rollback: async () => {},
            };
        },
    };
}

it('перезапуск видит намерение, старый токен не может начать новый шаг или завершить его', async () => {
    const pool = database();
    const journal = new OzonTransitionJournal(pool as any);
    const first = await journal.claim('539124-5', { percent: 11 });
    const resumed = new OzonTransitionJournal(pool as any);
    expect(await resumed.pending('539124-5')).toEqual(first);
    expect(await resumed.claim('539124-5', { percent: 63 })).toBeNull();
    const next = await resumed.advance('539124-5', first.token, { base: 822 });
    expect(next.token).not.toBe(first.token);
    expect(await journal.advance('539124-5', first.token, { base: 808 })).toBeNull();
    expect(await journal.finish('539124-5', first.token)).toBe(false);
    expect([...await resumed.outstanding()]).toEqual([['539124-5', next]]);
    expect(await resumed.finish('539124-5', next.token)).toBe(true);
    expect(await resumed.pending('539124-5')).toBeNull();
    expect(await resumed.claim('539124-5', { percent: 12 })).toBeTruthy();
    expect(pool.calls.some(sql => sql.endsWith('WITH LOCK'))).toBe(true);
});

it('только подтверждённая операция атомарно создаёт одну квитанцию для бота', async () => {
    const pool = database();
    const journal = new OzonTransitionJournal(pool as any);
    const claim = await journal.claim('563967-4', { price: 640 });
    const result = { offerId: '563967-4', applied: true, verification: 'confirmed' } as any;
    await expect(journal.finish('563967-4', claim.token, undefined, { ...result, verification: 'pending' })).rejects.toThrow();
    expect(await journal.pending('563967-4')).toEqual(claim);
    expect(await journal.finish('563967-4', claim.token, undefined, result)).toBe(true);
    expect(await journal.finish('563967-4', claim.token, undefined, result)).toBe(false);
    const notices = await new OzonTransitionJournal(pool as any).outstanding('PROMO_NOTICE');
    expect([...notices.keys()]).toEqual([claim.token]);
    expect(notices.get(claim.token).payload).toEqual({ result });
});

it('завершённый конкурентный переход инвалидирует снимок, даже когда pending снова пуст', async () => {
    const journal = new OzonTransitionJournal(database() as any);
    const offer = '539124-5';
    const before = (await journal.versions([offer])).get(offer) ?? null;
    const concurrent = await journal.claim(offer, { price: 808 }, undefined, before);
    const during = (await journal.versions([offer])).get(offer);
    expect(during).toBe(concurrent.token);
    await journal.finish(offer, concurrent.token);
    expect(await journal.pending(offer)).toBeNull();
    expect(await journal.claim(offer, { price: 822 }, undefined, before)).toBeNull();
    expect(await journal.claim(offer, { price: 822 }, undefined, during)).toBeNull();
    const after = (await journal.versions([offer])).get(offer);
    expect(await journal.claim(offer, { price: 822 }, undefined, after)).toBeTruthy();
});

it('сохраняет подтверждение базовой цены до следующего импорта и инвалидирует его в транзакции', async () => {
    const journal = new OzonTransitionJournal(database() as any);
    const offer = '545388';
    const receipt = { productId: 13, price: 699, minPrice: 279, oldPrice: 810 };
    const step = await journal.claim(offer, { phase: 'import' }, undefined, null, null);
    await journal.finish(offer, step.token, undefined, undefined, receipt);
    const stored = await journal.baseReceipts([offer]);
    const state = { offerId: offer, productId: 13, price: 294, minPrice: 279, oldPrice: 810,
        ozonActions: [{ actionPrice: 294, participant: true, startsAt: null }] } as any;
    expect(attachOzonBaseReceipts([state], stored)[0].confirmedBase).toBe(699);
    expect(attachOzonBaseReceipts([{...state, oldPrice:811}], stored)[0].confirmedBase).toBeUndefined();
    expect(attachOzonBaseReceipts([{...state, productId:14}], stored)[0].confirmedBase).toBeUndefined();
    expect(attachOzonBaseReceipts([{...state, ozonActions:[]}], stored)[0].confirmedBase).toBeUndefined();
    await journal.claim(offer, {phase:'second import'}, undefined, null, null);
    expect((await journal.baseReceipts([offer])).get(offer)).toEqual(receipt);
    const version = (await journal.versions([offer])).get(offer);
    expect(await journal.claim(offer, {phase:'second import'}, undefined, version, null)).toBeTruthy();
    expect((await journal.baseReceipts([offer])).size).toBe(0);
});

it('читает обе выборки по 100 уникальных артикулов и обрабатывает остаток', async () => {
    const pool = database();
    const journal = new OzonTransitionJournal(pool as any);
    const offers = Array.from({ length: 205 }, (_, i) => String(i));
    const receipt = { productId: 1, price: 300, minPrice: 200, oldPrice: 400 };
    const step = await journal.claim('204', {}, 'PRICE_STEP', null, receipt);
    pool.calls.length = 0;
    expect((await journal.versions([...offers, '204'])).get('204')).toBe(step.token);
    expect((await journal.baseReceipts([...offers, '204'])).get('204')).toEqual(receipt);
    expect(pool.calls.map(sql => sql.split('EXT_ID IN (')[1].match(/\?/g).length)).toEqual([100, 100, 5, 100, 100, 5]);
});

it('читает длинную квитанцию полностью, включая кириллицу и многобайтные символы', async () => {
    const journal = new OzonTransitionJournal(database() as any);
    const notice = { notes: 'Цена подтверждена 🔔 '.repeat(600) };
    const claim = await journal.claim('569740', notice, 'PROMO_NOTICE');
    expect((await journal.outstanding('PROMO_NOTICE')).get('569740')).toEqual(claim);
});
