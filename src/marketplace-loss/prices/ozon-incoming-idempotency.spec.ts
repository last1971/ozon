import type { OzonIncomingFixtureState, setup } from '../../../test/fixtures/ozon-incoming-promos.fixture';

/** Новый реестр модулей сбрасывает и сервисы, и глобальную очередь/версии цен.
 * Между запусками передаём только JSON состояния внешних систем, никаких объектов приложения. */
async function coldStart(saved?: OzonIncomingFixtureState) {
    let runtime: ReturnType<typeof setup>;
    await jest.isolateModulesAsync(async () => {
        const fixture = await import('../../../test/fixtures/ozon-incoming-promos.fixture');
        runtime = fixture.setup(saved ? JSON.parse(JSON.stringify(saved)) : undefined);
    });
    return runtime;
}
const counts = (state: OzonIncomingFixtureState) => ({
    priceImports: state.requests.filter((r) => r.kind === 'price').length,
    actionUpdates: state.requests.filter((r) => r.kind === 'action').length,
    percentUpdates: state.requests.filter((r) => r.kind === 'percent').length,
    notifications: state.notifications.length,
});
const stableCounts = { priceImports: 2, actionUpdates: 1, percentUpdates: 0, notifications: 1 };
const assertStable = (state: OzonIncomingFixtureState) => expect(counts(state)).toEqual(stableCounts);

async function sixPasses() {
    let app = await coldStart();
    expect(app.target()).toMatchObject({ offer_id: '535776', price: '699', min_price: '279', old_price: '837' });
    for (let pass = 0; pass < 6; pass++) {
        if (pass === 3) {
            const oldAdapter = app.adapter;
            app = await coldStart(app.data);
            expect(app.adapter).not.toBe(oldAdapter);
        }
        const result = await app.runInvoice();
        // Не допускаем ложного успеха: ВБ всё ещё недоступен, приход обязан остаться в очереди.
        expect(result).not.toBeNull();
        expect(result.completed).toEqual([]);
        expect(result.failures).toEqual([
            {
                service: 'wb',
                offerId: '535776',
                error: 'Список артикулов площадки недоступен: загрузка завершилась ошибкой',
            },
        ]);
        expect(result.pending).toEqual([{ np: '50013', reasons: [expect.stringContaining('wb 535776:')] }]);
        expect(app.data.receipt.handled).toBe(false);
        expect(app.live).toEqual({ price: 294, min_price: 279, old_price: 837, marketing_seller_price: 279 });
    }
    return app.data;
}

it('приход с ошибкой ВБ: шесть проходов и холодный запуск не повторяют отправку 699 → 294', async () => {
    const state = await sixPasses();
    assertStable(state);
    expect(state.requests.filter((r) => r.kind === 'price').map((r) => {
        const [row] = r.body as {price: string; min_price: string}[];
        return [row.price, row.min_price];
    })).toEqual([['699','294'], ['699','279']]);
    expect(state.requests.filter((r) => r.kind === 'action').map((r) => (r.body as any[])[0].actionPrice)).toEqual([
        294,
    ]);
});

it('на холодном старте проверяет итог скидок, даже когда видимая база отличается от импортированной', async () => {
    const saved = await sixPasses();
    const app = await coldStart(saved);
    expect(Number(app.target().price)).toBe(699);
    expect(saved.live.price).toBe(294);
    expect(app.adapter.matches(app.target(), (await app.adapter.current([app.offer])).get(app.offer))).toBe(true);
    expect(saved.transitions).toEqual({});
});

it('отрицательный контроль: устаревшее сравнение отклоняет приход, но координатор защищает от повторного импорта', async () => {
    const saved = await sixPasses();
    const app = await coldStart(saved);
    const { ozonPricesMatch } = await import('../../helpers/price/ozon-prices-match');
    app.adapter.matches = (target, actual) => ozonPricesMatch(target, actual, 0);
    const result = await app.runInvoice();
    expect(result.failures.some((failure) => failure.service === 'ozon')).toBe(true);
    assertStable(app.data);
});

it('новая себестоимость после холодного запуска требует обновления; следующий повтор снова без записей', async () => {
    const saved = await sixPasses();
    saved.cost = 200;
    saved.receipt.version = 'v2';
    let app = await coldStart(saved);
    expect(app.target()).toMatchObject({ price: '1398', min_price: '558', old_price: '1674' });
    const changed = await app.runInvoice();
    expect(changed.failures).toHaveLength(1);
    expect(changed.failures[0].service).toBe('wb');
    expect(app.live).toEqual({ price: 588, min_price: 558, old_price: 1674, marketing_seller_price: 559 });
    const after = JSON.parse(JSON.stringify(app.data));
    expect(counts(after)).toEqual({ priceImports: 3, actionUpdates: 3, percentUpdates: 0, notifications: 2 });
    app = await coldStart(after);
    await app.runInvoice();
    expect(app.data.requests).toEqual(after.requests);
    expect(app.data.notifications).toEqual(after.notifications);
    expect(app.data.receipt.handled).toBe(false);
});

it('без истории записи подтверждает скрытую base один раз, после рестарта сохраняет результат', async () => {
    const initial = await coldStart();
    const saved = initial.data;
    Object.assign(saved.live, { price: 294, min_price: 279, old_price: 837, marketing_seller_price: 279 });
    saved.actionPrice = 294;
    saved.regularPrice = 555;
    saved.receipt.payload = {};
    const app = await coldStart(saved);
    const result = await app.runInvoice();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].service).toBe('wb');
    expect(app.data.regularPrice).toBe(699);
    const after = counts(app.data);
    expect(after.priceImports).toBe(1);
    const restarted = await coldStart(app.data);
    await restarted.runInvoice();
    expect(counts(restarted.data)).toEqual(after);
    expect(restarted.data.notifications).toEqual(app.data.notifications);
});
