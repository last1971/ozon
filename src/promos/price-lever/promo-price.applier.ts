import { Injectable } from '@nestjs/common';
import { PricingSnapshot } from '../../helpers/price/price-update.queue';
import { SerialTaskOptions } from '../../helpers/serial-task.queue';
import { OzonPriceTransitionService } from './ozon-price-transition.service';
import { PromoPricePlan } from './promo-price.types';

export interface PromoApplyOptions extends SerialTaskOptions {
    snapshot?: PricingSnapshot;
    assertCurrent?: () => void | Promise<void>;
    notify?: boolean;
    shouldStop?: () => boolean;
}

/** Ручное изменение и фоновая сверка проходят через тот же журнал, что и импорт базовой цены. */
@Injectable()
export class PromoPriceApplier {
    constructor(private readonly transitions: OzonPriceTransitionService) {}

    apply(plan: PromoPricePlan, options: PromoApplyOptions = {}) {
        return this.transitions.applyPromo(plan, options);
    }

    applyBatch(plans: PromoPricePlan[], optionsFor: (plan: PromoPricePlan) => PromoApplyOptions) {
        return this.transitions.applyPromos(plans, optionsFor);
    }
}
