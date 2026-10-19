import { Test } from '@nestjs/testing';
import { OzonPromosApi } from '../promos.api';
import { PromosService } from '../promos.service';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { PromoPriceApplier } from './promo-price.applier';
import { PromoPricePlan, PromoPriceStep } from './promo-price.types';

describe('PromoPriceApplier — исполнение шагов плана', () => {
    let applier: PromoPriceApplier;
    const update = jest.fn();
    const setPercent = jest.fn();
    const remove = jest.fn();
    const calls: string[] = [];

    const okUpdate = (over: any = {}) => ({ added: [], removed: [], rejected: [], warnings: [], ...over });
    /** 532100 живьём: выкинуть из эластичного (967/1256), наш 5 → 14 %. */
    const plan = (steps: PromoPriceStep[], over: Partial<PromoPricePlan> = {}): PromoPricePlan =>
        ({
            offerId: '532100',
            productId: 77,
            target: 1943,
            percent: 14,
            floor: 2046,
            steps,
            buyerBefore: 919,
            buyerAfter: 1965,
            ok: true,
            notes: [],
            state: {
                ozonActions: [
                    {
                        actionId: 1977747,
                        title: 'Эластичный',
                        isVoucher: false,
                        participant: true,
                        actionPrice: 967,
                        maxActionPrice: 1256,
                        stock: 2,
                    },
                    {
                        actionId: 9,
                        title: 'Промокод',
                        isVoucher: true,
                        participant: true,
                        actionPrice: 900,
                        maxActionPrice: 0,
                        stock: 0,
                    },
                ],
            },
            ...over,
        }) as PromoPricePlan;
    const removeStep: PromoPriceStep = {
        kind: 'ozon-remove',
        actionId: 1977747,
        title: 'Эластичный',
        from: 967,
        reason: 'лимит',
    };
    const raise: PromoPriceStep = { kind: 'percent', actionId: 4376619, sku: 2720248572, from: 5, to: 14 };

    beforeEach(async () => {
        [update, setPercent, remove].forEach((m) => m.mockReset());
        calls.length = 0;
        update.mockImplementation(async () => (calls.push('update'), okUpdate({ added: [77] })));
        setPercent.mockImplementation(
            async (_: number, p: any[]) => (calls.push('percent'), { applied: p, rejected: [] }),
        );
        remove.mockImplementation(async () => (calls.push('remove'), { success_ids: [77], failed: [] }));
        const module = await Test.createTestingModule({
            providers: [
                PromoPriceApplier,
                { provide: OzonPromosApi, useValue: { update } },
                { provide: OzonSellerActionsApi, useValue: { setPercent } },
                { provide: PromosService, useValue: { remove } },
            ],
        }).compile();
        applier = module.get(PromoPriceApplier);
    });

    it('сначала Ozon-акции, потом процент — даже если в плане процент первым', async () => {
        const res = await applier.apply(plan([raise, removeStep]));
        expect(calls).toEqual(['remove', 'percent']);
        expect(res.applied).toBe(true);
        expect(res.results.map((r) => r.status)).toEqual(['ok', 'ok']);
    });

    it('выкинуть — единым правилом PromosService.remove ценой пола; промокодная — с признаком voucher', async () => {
        await applier.apply(plan([removeStep, { ...removeStep, actionId: 9, title: 'Промокод', from: 900 }]));
        expect(remove).toHaveBeenNthCalledWith(1, { id: 1977747, is_voucher_action: false }, [
            { productId: 77, actionPrice: 2046, stock: 2 },
        ]);
        expect(remove).toHaveBeenNthCalledWith(2, { id: 9, is_voucher_action: true }, [
            { productId: 77, actionPrice: 2046, stock: 0 },
        ]);
    });

    it('поставить цену в Ozon-акции — update с ценой шага и стоком слота', async () => {
        const set: PromoPriceStep = { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный', from: 967, to: 1256 };
        const res = await applier.apply(plan([set]));
        expect(update).toHaveBeenCalledWith(1977747, [{ productId: 77, actionPrice: 1256, stock: 2 }]);
        expect(res.results[0].status).toBe('ok');
    });

    it('снятие не прошло → повышение процента ПРОПУЩЕНО (двойная скидка), понижение выполняется', async () => {
        remove.mockResolvedValue({ success_ids: [], failed: [{ productId: 77, reason: 'нельзя' }] });
        const lower: PromoPriceStep = { ...raise, sku: 1, from: 21, to: 5 };
        const res = await applier.apply(plan([removeStep, raise, lower]));
        expect(res.results).toEqual([
            { step: removeStep, status: 'rejected', reason: 'нельзя' },
            { step: raise, status: 'skipped', reason: expect.stringContaining('двойная скидка') },
            { step: lower, status: 'ok' },
        ]);
        expect(setPercent).toHaveBeenCalledTimes(1);
        expect(setPercent).toHaveBeenCalledWith(4376619, [{ sku: 1, percent: 5 }]);
        expect(res.applied).toBe(false);
    });

    it('добавление в нашу акцию (from: null) — тоже повышение, при сбое Ozon пропускается', async () => {
        update.mockResolvedValue(okUpdate({ rejected: [{ productId: 77, reason: 'stock' }] }));
        const set: PromoPriceStep = { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный', from: null, to: 2046 };
        const res = await applier.apply(plan([set, { ...raise, from: null }]));
        expect(res.results.map((r) => r.status)).toEqual(['rejected', 'skipped']);
        expect(res.results[0].reason).toBe('stock');
    });

    it('update исключил товар вместо смены цены — rejected с понятной причиной', async () => {
        update.mockResolvedValue(okUpdate({ removed: [77] }));
        const set: PromoPriceStep = { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный', from: 967, to: 1256 };
        expect((await applier.apply(plan([set]))).results[0].reason).toContain('исключил');
    });

    it('процент отклонён (code5) и исключение API — rejected, не падение', async () => {
        setPercent.mockResolvedValueOnce({
            applied: [],
            rejected: [{ sku: 2720248572, reason: 'no activated products found' }],
        });
        let res = await applier.apply(plan([raise]));
        expect(res.results[0]).toEqual({ step: raise, status: 'rejected', reason: 'no activated products found' });
        update.mockRejectedValue(new Error('timeout'));
        const set: PromoPriceStep = { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный', from: 967, to: 1256 };
        res = await applier.apply(plan([set]));
        expect(res.results[0]).toEqual({ step: set, status: 'rejected', reason: 'timeout' });
    });

    it('шагов нет — applied: true, в API не ходим', async () => {
        const res = await applier.apply(plan([]));
        expect(res.applied).toBe(true);
        expect(calls).toEqual([]);
    });
});
