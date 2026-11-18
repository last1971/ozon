import { priceUpdateQueue, PricePlanStaleError } from '../../../helpers/price/price-update.queue';
import { emptyProgress } from '../../../interfaces/i.job.context';
import { PromoPricePlan, PromoPriceState } from '../promo-price.types';
import { ApplySweepCommand } from './apply-sweep.command';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { CollectSweepCommand } from './collect-sweep.command';
import { PlanSweepCommand } from './plan-sweep.command';
import { IPromoSweepContext } from './promo-sweep.context';
import { NotifySweepCommand } from './notify-sweep.command';

describe('сверка акций — команды цепочки', () => {
    const ctx = (over: Partial<IPromoSweepContext> = {}): IPromoSweepContext => ({
        apply: false,
        goal: 'below-min',
        progress: emptyProgress(),
        ...over,
    });
    const state = (productId: number, over: Partial<PromoPriceState> = {}): PromoPriceState => ({
        offerId: String(productId),
        productId,
        oldPrice: 321,
        price: 255,
        minPrice: 213,
        buyerPrice: 200,
        buyerPriceCalc: 200,
        seller: { actionId: 4376619, title: '26-10', minPercent: 7, sku: productId * 10, percent: 21, isActive: true },
        ozonActions: [],
        ...over,
    });

    it('отчёт отражает пересчитанный при применении план, а не первоначальную цену', async () => {
        const original = {
            offerId: '1',
            productId: 1,
            state: state(1),
            target: 213,
            buyerBefore: 200,
            buyerAfter: 214,
            percent: 7,
            floor: 213,
            steps: [{ kind: 'ozon-set', actionId: 5, title: 'Акция', from: 200, to: 214 }],
            notes: [],
            ok: true,
            closest: false,
        } as PromoPricePlan;
        const changed = {
            ...original,
            buyerAfter: 255,
            steps: [{ kind: 'ozon-remove', actionId: 5, title: 'Акция', from: 200, reason: 'свежий лимит ниже пола' }],
            notes: ['План пересчитан'],
            results: [{ step: { kind: 'ozon-remove' }, status: 'ok', changed: true }],
            verification: 'confirmed',
            applied: true,
        } as any;
        const result = await new BuildSweepReportCommand().execute(
            ctx({ apply: true, plans: [original], results: [changed] }),
        );
        expect(result.report).toMatchObject({ keptInOzon: 0, removedFromOzon: 1 });
        expect(result.report.items[0]).toMatchObject({ buyerAfter: 255, steps: changed.steps, notes: changed.notes });
    });

    it('collect: оставляет только ниже min_price; без цены покупателя или min_price — мимо', async () => {
        const allStates = jest
            .fn()
            .mockResolvedValue([
                state(1),
                state(2, { buyerPrice: 215 }),
                state(3, { buyerPrice: 0 }),
                state(4, { minPrice: 0 }),
            ]);
        const c = await new CollectSweepCommand({ allStates } as any).execute(ctx());
        expect(c.states?.map((s) => s.productId)).toEqual([1]);
        expect(c.progress.counters).toEqual({ checked: 4, selected: 1 });
    });

    it('collect «к минимальной»: в обе стороны от min_price, расхождение до рубля — мимо', async () => {
        const allStates = jest
            .fn()
            .mockResolvedValue([
                state(1),
                state(2, { buyerPrice: 240 }),
                state(3, { buyerPrice: 214 }),
                state(4, { buyerPrice: 0 }),
            ]);
        const c = await new CollectSweepCommand({ allStates } as any).execute(ctx({ goal: 'min' }));
        expect(c.states?.map((s) => s.productId)).toEqual([1, 2]);
    });

    it('collect «к нормальной»: всё, что не равно price', async () => {
        const allStates = jest
            .fn()
            .mockResolvedValue([state(1), state(2, { buyerPrice: 255 }), state(3, { buyerPrice: 237 })]);
        const c = await new CollectSweepCommand({ allStates } as any).execute(ctx({ goal: 'normal' }));
        expect(c.states?.map((s) => s.productId)).toEqual([1, 3]);
    });

    it.each(['min', 'below-min'] as const)('цель %s: отклонение на рубль за границу тарифа требует сверки', async (goal) => {
        const allStates = jest.fn().mockResolvedValue([300, 301].map((buyerPrice) =>
            state(buyerPrice, { price: 672, buyerPrice, minPrice: 300, calcMinPrice: 300, deadZoneFloor: 627 }),
        ));
        const c = await new CollectSweepCommand({ allStates } as any).execute(ctx({ goal }));
        expect(c.states?.map(s => s.buyerPrice)).toEqual([301]);
    });

    it('plan «ниже минимальной»: цель min, процент — минимум акции товара (7), а не 5 и не текущие 21', async () => {
        const c = await new PlanSweepCommand().execute(ctx({ states: [state(1)] }));
        expect(c.plans?.[0].steps).toEqual([{ kind: 'percent', actionId: 4376619, sku: 10, from: 21, to: 7 }]);
        expect(c.plans?.[0].buyerAfter).toBe(237);
    });

    it('plan «к минимальной» вниз: дорогой товар — наш процент вверх до цели, не ниже дна', async () => {
        const c = await new PlanSweepCommand().execute(
            ctx({ goal: 'min', states: [state(1, { buyerPrice: 242, seller: { ...state(1).seller!, percent: 5 } })] }),
        );
        expect(c.plans?.[0].target).toBe(213);
        expect(c.plans?.[0].steps).toEqual([{ kind: 'percent', actionId: 4376619, sku: 10, from: 5, to: 16 }]);
        expect(c.plans?.[0].buyerAfter).toBeGreaterThanOrEqual(213);
    });

    it('plan «к нормальной»: цель = price', async () => {
        const c = await new PlanSweepCommand().execute(ctx({ goal: 'normal', states: [state(1)] }));
        expect(c.plans?.[0].target).toBe(255);
    });

    describe('apply', () => {
        const executor = (apply: jest.Mock) => ({
            apply,
            applyBatch: async (plans, optionsFor) => {
                const results = [];
                for (const plan of plans) {
                    const options = optionsFor(plan);
                    if (options.shouldStop()) break;
                    results.push(await apply(plan, options));
                }
                return results;
            },
        });
        const plan = (productId: number, steps = 1) =>
            ({
                productId,
                steps: Array.from({ length: steps }, () => ({ kind: 'percent' })),
            }) as unknown as PromoPricePlan;

        it('без apply — исполнителя не зовём', async () => {
            const apply = jest.fn();
            await new ApplySweepCommand(executor(apply) as any, {} as any, {} as any).execute(ctx({ plans: [plan(1)] }));
            expect(apply).not.toHaveBeenCalled();
        });

        it('по одному, планы без шагов пропускаем, прогресс и счётчики', async () => {
            const apply = jest
                .fn()
                .mockImplementation(async (p) => ({ ...p, results: [], applied: p.productId === 1 }));
            const c = await new ApplySweepCommand(executor(apply) as any, {} as any, {} as any).execute(
                ctx({ apply: true, plans: [plan(1), plan(2, 0), plan(3)] }),
            );
            expect(apply).toHaveBeenCalledTimes(2);
            expect(c.progress).toMatchObject({ total: 2, done: 2, counters: { appliedOk: 1, appliedFailed: 1 } });
        });

        it('отмена (stopChain) между товарами — дальше не идём', async () => {
            const context = ctx({ apply: true, plans: [plan(1), plan(2)] });
            const apply = jest.fn().mockImplementation(async (p) => {
                context.stopChain = true;
                return { ...p, results: [], applied: true };
            });
            await new ApplySweepCommand(executor(apply) as any, {} as any, {} as any).execute(context);
            expect(apply).toHaveBeenCalledTimes(1);
        });

        describe('повтор при устаревшем плане', () => {
            const stalePlan = (): PromoPricePlan =>
                ({
                    offerId: '1',
                    productId: 1,
                    steps: [{ kind: 'percent', actionId: 4376619, sku: 10, from: 21, to: 7 }],
                    state: state(1),
                    target: 213, percent: 7, floor: 213,
                    buyerBefore: 200, baseAfter: 255, buyerAfter: 237,
                    ok: true, closest: false, notes: [],
                }) as unknown as PromoPricePlan;

            const staleResult = (over = {}) => ({
                ...stalePlan(),
                results: [{ step: stalePlan().steps[0], status: 'skipped', reason: 'устарел' }],
                applied: false, stale: true, attempted: false,
                ...over,
            });

            it.each(['success', 'snapshot', 'inputs', 'cancel'])(
                'closest без записи: %s', async (scenario) => {
                    // 1000 с 1% = 990; следующий процент даёт 980 < минимума 981.
                    const freshState = state(1, { price: 1000, minPrice: 981, calcMinPrice: 981,
                        buyerPrice: 990, buyerPriceCalc: 990,
                        seller: { ...state(1).seller!, minPercent: 1, percent: 1 } });
                    const apply = jest.fn().mockResolvedValueOnce(staleResult());
                    const context = ctx({ apply: true, goal: 'min', plans: [stalePlan()] });
                    context.assertInputsCurrent = jest.fn(async () => {
                        if (scenario === 'snapshot') priceUpdateQueue.changed('ozon', ['1']);
                        if (scenario === 'inputs') throw new Error('Приход изменился');
                        if (scenario === 'cancel') context.stopChain = true;
                    });
                    await new ApplySweepCommand(
                        executor(apply) as any,
                        { states: jest.fn().mockResolvedValue([freshState]) } as any,
                        { enrichOne: jest.fn().mockResolvedValue({ status: 'ready' }) } as any,
                    ).execute(context);
                    expect(apply).toHaveBeenCalledTimes(1);
                    expect(context.assertInputsCurrent).toHaveBeenCalledWith('1');
                    expect(context.results?.[0].applied).toBe(scenario === 'success');
                    if (scenario === 'success') {
                        expect(context.results?.[0]).toMatchObject({ closest: true, ok: true,
                            steps: [], results: [], attempted: false, stale: false });
                    }
                    const emit = jest.fn();
                    await new NotifySweepCommand({ emit } as any).execute(context);
                    expect(emit).not.toHaveBeenCalled();
                },
            );

            it('устаревший план без отправки → перечитать, пересчитать, применить', async () => {
                const retryResult = { ...stalePlan(), results: [{ step: stalePlan().steps[0], status: 'ok' }], applied: true, attempted: true };
                const apply = jest.fn()
                    .mockResolvedValueOnce(staleResult())
                    .mockResolvedValueOnce(retryResult);
                const freshState = state(1);
                const states = jest.fn().mockResolvedValue([freshState]);
                const enrichOne = jest.fn().mockResolvedValue({ status: 'ready' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(2);
                expect(states).toHaveBeenCalledWith(['1']);
                expect(enrichOne).toHaveBeenCalledWith(freshState);
                expect(c.results?.[0].applied).toBe(true);
                expect(c.results?.[0].notes[0]).toBe('Повтор после устаревшего плана');
                expect(c.progress.counters).toMatchObject({ appliedOk: 1 });
            });

            it('нет остатков при повторе → скидку не отправляем, причина в отчёте', async () => {
                const apply = jest.fn().mockResolvedValueOnce(staleResult());
                const enrichOne = jest.fn().mockResolvedValue({ status: 'no-stock' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn().mockResolvedValue([state(1)]) } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(false);
                expect(c.results?.[0].notes.some((n) => n.includes('нет остатков'))).toBe(true);
            });

            it('ошибка расчёта минимума при повторе → скидку не отправляем', async () => {
                const apply = jest.fn().mockResolvedValueOnce(staleResult());
                const enrichOne = jest.fn().mockResolvedValue({ status: 'error', reason: 'нет базы: товар не в прайсе' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn().mockResolvedValue([state(1)]) } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(false);
                expect(c.results?.[0].notes.some((n) => n.includes('нет базы'))).toBe(true);
            });

            it('данные изменились снова при повторе → причина в отчёте, третьей попытки нет', async () => {
                const apply = jest.fn()
                    .mockResolvedValueOnce(staleResult())
                    .mockResolvedValueOnce(staleResult({ notes: ['Повтор после устаревшего плана'] }));
                const enrichOne = jest.fn().mockResolvedValue({ status: 'ready' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn().mockResolvedValue([state(1)]) } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(2);
                expect(c.results?.[0].applied).toBe(false);
                expect(c.progress.counters).toMatchObject({ appliedFailed: 1 });
            });

            it('отправка уже началась (attempted: true) — не повторяем', async () => {
                const apply = jest.fn().mockResolvedValueOnce(staleResult({ attempted: true }));

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn() } as any,
                    { enrichOne: jest.fn() } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(false);
            });

            it('цель больше не выбирает товар после перечтения → скидка уже на месте', async () => {
                // buyerPrice 215 >= calcMinPrice 215 → belowMin.selects с calcMinPrice = false
                const freshState = state(1, { buyerPrice: 215, calcMinPrice: 215 });
                const apply = jest.fn().mockResolvedValueOnce(staleResult());
                const enrichOne = jest.fn().mockResolvedValue({ status: 'ready' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn().mockResolvedValue([freshState]) } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(true);
                expect(c.results?.[0].notes[0]).toContain('скидка уже на месте');
            });

            it('скидка уже на месте, но данные изменились за время проверки → не сообщаем об успехе', async () => {
                // calcMinPrice делает товар «в норме», но снимок устаревает во время run()
                const freshState = state(1, { buyerPrice: 215, calcMinPrice: 215 });
                const apply = jest.fn().mockResolvedValueOnce(staleResult());
                const enrichOne = jest.fn().mockResolvedValue({ status: 'ready' });
                // Имитируем изменение данных между capture и assertCurrent:
                // мокаем priceUpdateQueue.run так, чтобы он бросал PricePlanStaleError
                const runSpy = jest.spyOn(priceUpdateQueue, 'run').mockRejectedValueOnce(new PricePlanStaleError('тест'));

                let c: IPromoSweepContext;
                try {
                    c = await new ApplySweepCommand(
                        executor(apply) as any,
                        { states: jest.fn().mockResolvedValue([freshState]) } as any,
                        { enrichOne } as any,
                    ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));
                } finally {
                    runSpy.mockRestore();
                }

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(false);
                expect(c.results?.[0].notes.some((n) => n.includes('данные изменились за время проверки'))).toBe(true);
            });

            it('минимум Ozon выше расчётного — ждём обновления цены через прайс-лист', async () => {
                // minPrice=300, calcMinPrice=250 → акция не может опуститься ниже 300 до обновления
                const freshState = state(1, { minPrice: 300, buyerPrice: 290, calcMinPrice: 250 });
                const apply = jest.fn().mockResolvedValueOnce(staleResult());
                const enrichOne = jest.fn().mockResolvedValue({ status: 'ready' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn().mockResolvedValue([freshState]) } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(false);
                expect(c.results?.[0].notes.some((n) => n.includes('ждём обновления цены'))).toBe(true);
            });

            it('план после перечтения не обеспечивает минимальную прибыль → скидку не отправляем', async () => {
                // calcMinPrice=250 > price=230 → buyerAfter≈214 < eff=250 → plan.ok=false
                const freshState = state(1, { calcMinPrice: 250, price: 230 });
                const apply = jest.fn().mockResolvedValueOnce(staleResult());
                const enrichOne = jest.fn().mockResolvedValue({ status: 'ready' });

                const c = await new ApplySweepCommand(
                    executor(apply) as any,
                    { states: jest.fn().mockResolvedValue([freshState]) } as any,
                    { enrichOne } as any,
                ).execute(ctx({ apply: true, goal: 'below-min', plans: [stalePlan()] }));

                expect(apply).toHaveBeenCalledTimes(1);
                expect(c.results?.[0].applied).toBe(false);
                expect(c.results?.[0].notes.some((n) => n.includes('минимальную прибыль'))).toBe(true);
            });
        });
    });

    it('report: счётчики по шагам, нелечимые и непрошедшие — первыми', async () => {
        const p = (productId: number, steps: string[], ok = true, buyerBefore = 200, closest = false): PromoPricePlan =>
            ({
                offerId: String(productId),
                productId,
                steps: steps.map((kind) => ({ kind })),
                notes: [],
                ok,
                closest,
                buyerBefore,
                buyerAfter: 214,
                target: 213,
                state: { price: 255, minPrice: 213 },
            }) as unknown as PromoPricePlan;
        const plans = [
            p(1, ['ozon-set'], true, 210),
            p(2, ['ozon-remove', 'percent'], true, 100),
            p(3, ['percent'], false, 205),
            p(4, [], true, 212),
            p(5, [], true, 215, true),
        ];
        const c = await new BuildSweepReportCommand().execute(
            ctx({
                apply: true,
                checked: 600,
                plans,
                results: [{ ...plans[0], results: [], applied: false } as any],
            }),
        );
        expect(c.report).toMatchObject({
            apply: true,
            goal: 'below-min',
            checked: 600,
            selected: 5,
            keptInOzon: 0,
            removedFromOzon: 0,
            percentChanged: 0,
            unfixable: 1,
            closest: 1,
            nothingToDo: 1,
            failed: 1,
        });
        expect(c.report?.items.map((i) => i.productId)).toEqual([3, 1, 2, 5, 4]);
        expect(c.report?.items.find((i) => i.productId === 5)).toMatchObject({ closest: true });
        expect(c.report?.items[1]).toMatchObject({ applied: false, price: 255, minPrice: 213 });
        expect(c.report?.items[0]).not.toHaveProperty('state');
    });
});
