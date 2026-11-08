import { Inject, Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { ExtraPriceService } from '../../../price/extra.price.service';
import { GOOD_SERVICE, IGood } from '../../../interfaces/IGood';
import { GoodServiceEnum } from '../../../good/good.service.enum';
import { MpService } from '../../../mp-event/mp-event.service';
import { pricingFailureKind } from '../../../helpers/price/pricing-error';
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
            const pc: PriceContext = { priceables: new Map(), issues: new Map() };
            priceContexts.set(service, pc);
            const ids = [...skus];
            try {
                pc.coeffs = priceService.getObtainCoeffs();
            } catch (error) {
                for (const id of ids)
                    pc.issues.set(id, {
                        kind: pricingFailureKind(error) === 'temporary' ? 'temporary' : 'invalid-data',
                        reason: `настройки расчёта недоступны: ${error.message}`,
                    });
                continue;
            }
            // Общий сборщик изолирует ошибку артикула через onSkip; сбой целой пачки
            // не отменяет следующие пачки. Формулы и чтение тарифов остаются в сборщике.
            for (let offset = 0; offset < ids.length; offset += 100) {
                const batch = ids.slice(offset, offset + 100);
                try {
                    const rows = await this.goods.buildPriceables(priceService, batch, undefined, (skip) => {
                        const missing = ['no-base', 'no-free-stock', 'not-in-stock'].includes(skip.reason);
                        pc.issues.set(skip.offer_id, {
                            kind: missing
                                ? 'missing-base'
                                : skip.failureKind === 'temporary'
                                  ? 'temporary'
                                  : 'invalid-data',
                            reason:
                                skip.message ??
                                (missing ? 'нет себестоимости для расчёта' : 'некорректные данные расчёта'),
                        });
                    });
                    for (const row of rows) {
                        if (batch.includes(row.offer_id) && !pc.issues.has(row.offer_id))
                            pc.priceables.set(row.offer_id, row);
                    }
                } catch (error) {
                    this.logger.warn(`${service}: данные расчёта не собраны — ${error.message}`);
                    for (const id of batch)
                        pc.issues.set(id, {
                            kind: pricingFailureKind(error) === 'temporary' ? 'temporary' : 'invalid-data',
                            reason: `данные расчёта недоступны: ${error.message}`,
                        });
                }
            }
        }
        return { ...ctx, priceContexts };
    }
}
