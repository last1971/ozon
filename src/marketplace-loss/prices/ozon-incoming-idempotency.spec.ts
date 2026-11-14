import type { OzonIncomingFixtureState, setup } from '../../../test/fixtures/ozon-incoming-promos.fixture';

/** Новый реестр модулей сбрасывает и сервисы, и глобальную очередь/версии цен.
 * Между запусками передаём только JSON состояния внешних систем, никаких объектов приложения. */
async function coldStart(saved?: OzonIncomingFixtureState, legacyComparison = false) {
    let runtime: ReturnType<typeof setup>;
    await jest.isolateModulesAsync(async () => {
        const fixture = await import('../../../test/fixtures/ozon-incoming-promos.fixture');
        runtime = fixture.setup(saved ? JSON.parse(JSON.stringify(saved)) : undefined, { legacyComparison });
    });
    return runtime;
}
const counts = (state: OzonIncomingFixtureState) => ({
    priceImports: state.requests.filter((r) => r.kind === 'price').length,
    actionUpdates: state.requests.filter((r) => r.kind === 'action').length,
    percentUpdates: state.requests.filter((r) => r.kind === 'percent').length,
    notifications: state.notifications.length,
});
const stableCounts = { priceImports: 1, actionUpdates: 1, percentUpdates: 0, notifications: 1 };
const assertStable = (state: OzonIncomingFixtureState) => expect(counts(state)).toEqual(stableCounts);

async function sixPasses(legacyComparison = false) {
    let app = await coldStart(undefined, legacyComparison);
    expect(app.target()).toMatchObject({ offer_id: '535776', price: '699', min_price: '279', old_price: '837' });
    for (let pass = 0; pass < 6; pass++) {
        if (pass === 3) {
            const oldAdapter = app.adapter;
            app = await coldStart(app.data, legacyComparison);
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
    expect(state.requests.filter((r) => r.kind === 'price').map((r) => (r.body as any[])[0].price)).toEqual(['699']);
    expect(state.requests.filter((r) => r.kind === 'action').map((r) => (r.body as any[])[0].actionPrice)).toEqual([
        294,
    ]);
});

it('отрицательный контроль: старое сравнение НЕ проходит тот же критерий — шесть сбросов и шесть уведомлений', async () => {
    const state = await sixPasses(true);
    expect(counts(state)).toEqual({ priceImports: 6, actionUpdates: 6, percentUpdates: 0, notifications: 6 });
    expect(state.requests.filter((r) => r.kind === 'price').map((r) => (r.body as any[])[0].price)).toEqual(
        Array(6).fill('699'),
    );
    expect(state.requests.filter((r) => r.kind === 'action').map((r) => (r.body as any[])[0].actionPrice)).toEqual(
        Array(6).fill(294),
    );
    // Именно приемочный критерий исправления обязан отвергнуть старое сравнение.
    expect(() => assertStable(state)).toThrow();
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
    expect(counts(after)).toEqual({ priceImports: 2, actionUpdates: 2, percentUpdates: 0, notifications: 2 });
    app = await coldStart(after);
    await app.runInvoice();
    expect(app.data.requests).toEqual(after.requests);
    expect(app.data.notifications).toEqual(after.notifications);
    expect(app.data.receipt.handled).toBe(false);
});

it('правильная акция распознаётся без сохранённой отметки успеха предыдущего процесса', async () => {
    const initial = await coldStart();
    const saved = initial.data;
    Object.assign(saved.live, { price: 294, min_price: 279, old_price: 837, marketing_seller_price: 279 });
    saved.actionPrice = 294;
    saved.receipt.payload = {};
    const app = await coldStart(saved);
    const result = await app.runInvoice();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].service).toBe('wb');
    expect(counts(app.data)).toEqual({ priceImports: 0, actionUpdates: 0, percentUpdates: 0, notifications: 0 });
});
