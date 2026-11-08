import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PRICING_INPUTS_CHANGED, PricingInputsChanged } from '../helpers/price/pricing-inputs-changed';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
import { LOSS_SAVED_EVENT } from '../marketplace-loss/prices/loss-price.contracts';

/** Мост существующих событий в проверку актуальности планов; задания и проценты здесь не хранятся. */
@Injectable()
export class PricingInputsRevisionService {
    @OnEvent(PRICING_INPUTS_CHANGED)
    inputsChanged(change: PricingInputsChanged) {
        priceUpdateQueue.inputsChanged(change);
    }
    @OnEvent(LOSS_SAVED_EVENT)
    lossSaved(service: string, offers?: string[]) {
        priceUpdateQueue.inputsChanged({ service: service.toUpperCase() as 'OZON' | 'WB', offers });
    }
    @OnEvent('counts.changed')
    countsChanged(goods: { code: string | number }[]) {
        priceUpdateQueue.inputsChanged({ codes: goods.map((g) => String(g.code)) });
    }
}
