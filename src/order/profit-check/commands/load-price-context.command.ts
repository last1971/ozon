import { Inject, Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { ExtraPriceService } from '../../../price/extra.price.service';
import { GOOD_SERVICE, IGood } from '../../../interfaces/IGood';
import { GoodServiceEnum } from '../../../good/good.service.enum';
import { MpService } from '../../../mp-event/mp-event.service';
import { PriceContext, ProfitCheckContext } from '../profit-check.types';

const MP_TO_GOOD: Record<string, GoodServiceEnum> = {
    OZON: GoodServiceEnum.OZON,
    WB: GoodServiceEnum.WB,
    YANDEX: GoodServiceEnum.YANDEX,
};

/**
 * 3. Данные для расчёта по каждой площадке: себестоимость, наценки, комиссия, доставка —
 * через тот же сборщик, что кормит пересчёт цен (IGood.buildPriceables). Площадка, выключенная
 * на узле, даёт null — её заказы уйдут как «не проверено».
 */
@Injectable()
export class LoadPriceContextCommand implements ICommandAsync<ProfitCheckContext> {
    private readonly logger = new Logger(LoadPriceContextCommand.name);

    constructor(
        private readonly prices: ExtraPriceService,
        @Inject(GOOD_SERVICE) private readonly goods: IGood,
    ) {}

    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const skusByService = new Map<MpService, Set<string>>();
        for (const item of ctx.items) {
            if (!item.resolved) continue;
            const set = skusByService.get(item.payload.service) ?? new Set<string>();
            for (const l of item.payload.lines) set.add(l.offer_id);
            skusByService.set(item.payload.service, set);
        }
        const priceContexts = new Map<MpService, PriceContext | null>();
        for (const [service, skus] of skusByService) {
            const priceService = this.prices.getService(MP_TO_GOOD[service]);
            if (!priceService) {
                priceContexts.set(service, null);
                continue;
            }
            try {
                const priceables = await this.goods.buildPriceables(priceService, [...skus]);
                priceContexts.set(service, {
                    priceables: new Map(priceables.map((p) => [p.offer_id, p])),
                    coeffs: priceService.getObtainCoeffs(),
                });
            } catch (e) {
                this.logger.warn(`${service}: данные расчёта не собраны — ${e.message}`);
                priceContexts.set(service, null);
            }
        }
        return { ...ctx, priceContexts };
    }
}
