import { emptyProgress } from '../../../interfaces/i.job.context';
import { PromoPricePlan, PromoPriceState } from '../promo-price.types';
import { ApplySweepCommand } from './apply-sweep.command';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { CollectSweepCommand } from './collect-sweep.command';
import { PlanSweepCommand } from './plan-sweep.command';
import { IPromoSweepContext } from './promo-sweep.context';

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

    it('collect: оставляет только ниже min_price; без цены покупателя или min_price — мимо', async () => {
        const allInActionsStates = jest
            .fn()
            .mockResolvedValue([
                state(1),
                state(2, { buyerPrice: 215 }),
                state(3, { buyerPrice: 0 }),
                state(4, { minPrice: 0 }),
            ]);
        const c = await new CollectSweepCommand({ allInActionsStates } as any).execute(ctx());
        expect(c.states?.map((s) => s.productId)).toEqual([1]);
        expect(c.progress.counters).toEqual({ checked: 4, selected: 1 });
    });

    it('collect «к минимальной»: в обе стороны от min_price, расхождение до рубля — мимо', async () => {
        const allInActionsStates = jest
            .fn()
            .mockResolvedValue([
                state(1),
                state(2, { buyerPrice: 240 }),
                state(3, { buyerPrice: 214 }),
                state(4, { buyerPrice: 0 }),
            ]);
        const c = await new CollectSweepCommand({ allInActionsStates } as any).execute(ctx({ goal: 'min' }));
        expect(c.states?.map((s) => s.productId)).toEqual([1, 2]);
    });

    it('collect «к нормальной»: всё, что не равно price', async () => {
        const allInActionsStates = jest
            .fn()
            .mockResolvedValue([state(1), state(2, { buyerPrice: 255 }), state(3, { buyerPrice: 237 })]);
        const c = await new CollectSweepCommand({ allInActionsStates } as any).execute(ctx({ goal: 'normal' }));
        expect(c.states?.map((s) => s.productId)).toEqual([1, 3]);
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
        const plan = (productId: number, steps = 1) =>
            ({
                productId,
                steps: Array.from({ length: steps }, () => ({ kind: 'percent' })),
            }) as unknown as PromoPricePlan;

        it('без apply — исполнителя не зовём', async () => {
            const apply = jest.fn();
            await new ApplySweepCommand({ apply } as any).execute(ctx({ plans: [plan(1)] }));
            expect(apply).not.toHaveBeenCalled();
        });

        it('по одному, планы без шагов пропускаем, прогресс и счётчики', async () => {
            const apply = jest
                .fn()
                .mockImplementation(async (p) => ({ ...p, results: [], applied: p.productId === 1 }));
            const c = await new ApplySweepCommand({ apply } as any).execute(
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
            await new ApplySweepCommand({ apply } as any).execute(context);
            expect(apply).toHaveBeenCalledTimes(1);
        });
    });

    it('report: счётчики по шагам, нелечимые и непрошедшие — первыми', async () => {
        const p = (productId: number, steps: string[], ok = true, buyerBefore = 200): PromoPricePlan =>
            ({
                offerId: String(productId),
                productId,
                steps: steps.map((kind) => ({ kind })),
                notes: [],
                ok,
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
            selected: 4,
            keptInOzon: 1,
            removedFromOzon: 1,
            percentChanged: 2,
            unfixable: 1,
            nothingToDo: 1,
            failed: 1,
        });
        expect(c.report?.items.map((i) => i.productId)).toEqual([3, 1, 2, 4]);
        expect(c.report?.items[1]).toMatchObject({ applied: false, price: 255, minPrice: 213 });
        expect(c.report?.items[0]).not.toHaveProperty('state');
    });
});
