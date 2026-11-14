import { priceUpdateQueue, PricingSnapshot } from '../../helpers/price/price-update.queue';
import { SerialTaskOptions } from '../../helpers/serial-task.queue';
import { ProductService } from '../../product/product.service';
import { ProductVisibility } from '../../product/product.visibility';
import { refreshPromoPlan } from './promo-price.refresh';
import { Injectable, Logger } from '@nestjs/common';
import { OzonPromosApi } from '../promos.api';
import { PromosService } from '../promos.service';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceStep, PromoStepResult } from './promo-price.types';

export interface PromoApplyOptions extends SerialTaskOptions {
    snapshot?: PricingSnapshot;
    assertCurrent?: () => void | Promise<void>;
}

type Step<K extends PromoPriceStep['kind']> = Extract<PromoPriceStep, { kind: K }>;

/**
 * Исполняет шаги плана планировщика на Ozon. Решений не принимает — только выполняет и честно докладывает.
 *
 * Порядок: сначала Ozon-акции (выкинуть / поставить цену), потом процент нашей акции — так нет окна,
 * в котором старая цена Ozon-акции и новый процент складываются ниже дна. Если хоть один шаг по Ozon-акции
 * не прошёл, ПОВЫШЕНИЕ процента пропускается (иначе двойная скидка); понижение безопасно и выполняется.
 * Снятие — единственным правилом PromosService.remove; процент — по одному товару (code5 не говорит, кому отказано).
 */
@Injectable()
export class PromoPriceApplier {
    private readonly logger = new Logger(PromoPriceApplier.name);

    constructor(
        private readonly api: OzonPromosApi,
        private readonly sellerApi: OzonSellerActionsApi,
        private readonly promos: PromosService,
        private readonly products: ProductService,
    ) {}

    async apply(plan: PromoPricePlan, options: PromoApplyOptions = {}): Promise<PromoPriceApplyResult> {
        try {
            return await priceUpdateQueue.run(
                'ozon',
                async () => {
                    const assertCurrent = async () => {
                        await options.assertCurrent?.();
                        if (options.snapshot) priceUpdateQueue.assertCurrent(options.snapshot);
                    };
                    await assertCurrent();
                    {
                        const current = await this.products.getPrices({
                            offer_id: [plan.offerId],
                            visibility: ProductVisibility.ALL,
                            limit: 1,
                        });
                        const row = current?.items?.find((p) => p.offer_id === plan.offerId);
                        if (
                            !row ||
                            Number(row.product_id) !== plan.productId ||
                            (['price', 'min_price', 'old_price', 'marketing_seller_price'] as const).some(
                                (key, i) =>
                                    Number(row.price?.[key]) !==
                                    [plan.state.price, plan.state.minPrice, plan.state.oldPrice, plan.state.buyerPrice][
                                        i
                                    ],
                            )
                        )
                            throw new Error('Текущая цена Ozon изменилась. План устарел; требуется новая сверка.');
                    }
                    plan = await refreshPromoPlan(plan, this.api);
                    await assertCurrent();
                    try {
                        return await this.executePlan(plan);
                    } finally {
                        if (plan.steps.length)
                            priceUpdateQueue.changed('ozon', [plan.offerId, `#product:${plan.productId}`]);
                    }
                },
                options,
            );
        } catch (error) {
            return {
                ...plan,
                applied: false,
                notes: [...plan.notes, `Изменение пропущено: ${error.message}`],
                results: plan.steps.map((step) => ({
                    step,
                    status: 'skipped',
                    reason: `Не удалось проверить текущие условия акции: ${error.message}`,
                })),
            };
        }
    }
    private async executePlan(plan: PromoPricePlan): Promise<PromoPriceApplyResult> {
        const results: PromoStepResult[] = [];
        const ozonSteps = plan.steps.filter((s) => s.kind !== 'percent');
        const percentSteps = plan.steps.filter((s): s is Step<'percent'> => s.kind === 'percent');

        for (const step of ozonSteps) {
            results.push(await this.runOzon(step as Step<'ozon-set'> | Step<'ozon-remove'>, plan));
        }
        const ozonFailed = results.some((r) => r.status !== 'ok');
        for (const step of percentSteps) {
            const raises = step.from === null || step.to > step.from;
            if (ozonFailed && raises) {
                results.push({
                    step,
                    status: 'skipped',
                    reason: 'не прошёл шаг по Ozon-акции — процент не повышаем, иначе двойная скидка ниже минимальной',
                });
                continue;
            }
            results.push(await this.runPercent(step));
        }

        const applied = results.every((r) => r.status === 'ok');
        this.logger.log(
            `${plan.offerId}: ${results.map((r) => `${r.step.kind}:${r.status}`).join(', ') || 'шагов нет'} ` +
                `→ покупателю ${plan.buyerBefore} → ${plan.buyerAfter}`,
        );
        return { ...plan, results, applied };
    }

    private async runOzon(
        step: Step<'ozon-set'> | Step<'ozon-remove'>,
        plan: PromoPricePlan,
    ): Promise<PromoStepResult> {
        const slot = plan.state.ozonActions.find((a) => a.actionId === step.actionId);
        const stock = slot?.stock ?? 0;
        try {
            if (step.kind === 'ozon-remove') {
                const res = await this.promos.remove(
                    { id: step.actionId, is_voucher_action: Boolean(slot?.isVoucher) },
                    [{ productId: plan.productId, actionPrice: plan.floor, stock }],
                );
                if (res.success_ids.includes(plan.productId)) return { step, status: 'ok' };
                const failed = res.failed.find((f) => f.productId === plan.productId);
                return {
                    step,
                    status: 'rejected',
                    reason: failed?.reason || 'Ozon не подтвердил снятие (товар мог остаться в акции по цене пола)',
                };
            }
            const res = await this.api.update(step.actionId, [
                { productId: plan.productId, actionPrice: step.to, stock },
            ]);
            if (res.added.includes(plan.productId)) return { step, status: 'ok', changed: true };
            if (res.unchanged.includes(plan.productId)) return { step, status: 'ok', reason: 'уже стоит', changed: false };
            const rejected = res.rejected.find((r) => r.productId === plan.productId);
            if (rejected) return { step, status: 'rejected', reason: rejected.reason };
            if (res.removed.includes(plan.productId)) {
                return { step, status: 'rejected', reason: 'Ozon исключил товар из акции вместо смены цены' };
            }
            return { step, status: 'rejected', reason: res.warnings.join('; ') || 'Ozon не подтвердил цену' };
        } catch (e) {
            return { step, status: 'rejected', reason: (e as Error).message };
        }
    }

    private async runPercent(step: Step<'percent'>): Promise<PromoStepResult> {
        try {
            const res = await this.sellerApi.setPercent(step.actionId, [{ sku: step.sku, percent: step.to }]);
            if (res.applied.length) return { step, status: 'ok' };
            return { step, status: 'rejected', reason: res.rejected[0]?.reason || 'Ozon не принял процент' };
        } catch (e) {
            return { step, status: 'rejected', reason: (e as Error).message };
        }
    }
}
