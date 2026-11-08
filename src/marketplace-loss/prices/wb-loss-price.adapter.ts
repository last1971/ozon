import { PricingSnapshot } from '../../helpers/price/price-update.queue';
import { Injectable } from '@nestjs/common';
import { WbPriceService } from '../../wb.price/wb.price.service';
import { WbCurrentPrice, WbCurrentPricesService } from '../../wb.price/wb.current-prices.service';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { wbPriceTask } from '../../wb.price/wb-price-task';
import { LossPriceAdapter, LossPriceResult } from './loss-price.contracts';

@Injectable()
export class WbLossPriceAdapter implements LossPriceAdapter {
    constructor(
        readonly pricing: WbPriceService,
        private readonly prices: WbCurrentPricesService,
    ) {}
    async offers() {
        return [...(await this.prices.getAll()).keys()];
    }
    async current(_offers: string[]): Promise<Map<string, unknown>> {
        return this.prices.getAll();
    }
    availability(offers: string[]) { return this.pricing.getPricingAvailability(offers); }
    matches(target: UpdatePriceDto, actual: unknown) {
        if (!actual) return false;
        const current = actual as WbCurrentPrice;
        const wanted = wbPriceTask(target, current.nmID);
        return Number.isFinite(current.price) && wanted.price === current.price && wanted.discount === current.discount;
    }
    persist(targets: UpdatePriceDto[]) {
        return this.pricing.saveMinPrices(targets);
    }
    async send(targets: UpdatePriceDto[], current?: Map<string, unknown>) {
        const response = await this.pricing.updatePrices(targets, current as Map<string, WbCurrentPrice>);
        const rows = new Map<string, { status: string; message?: string }>(
            (response?.results ?? []).map((r) => [r.offer_id, r]),
        );
        return new Map(
            targets.map((t): [string, LossPriceResult] => {
                const row = rows.get(t.offer_id);
                return [
                    t.offer_id,
                    row && ['accepted', 'unchanged'].includes(row.status)
                        ? null
                        : { message: row?.message || 'ВБ не подтвердил приём цены', kind: row ? 'data' : 'temporary' },
                ];
            }),
        );
    }
    async promos(
        offers: string[],
        snapshots?: Map<string, PricingSnapshot>,
        assertInputsCurrent?: (offerId: string) => Promise<void>,
    ) {
        const report = assertInputsCurrent
            ? await this.pricing.setMinPrices(offers, false, snapshots, assertInputsCurrent)
            : snapshots
              ? await this.pricing.setMinPrices(offers, false, snapshots)
              : await this.pricing.setMinPrices(offers);
        return new Map(
            offers.map((offer): [string, LossPriceResult] => {
                const error = report.errors.find((e) => e.startsWith(offer + ':'));
                if (error) return [offer, { message: error, kind: 'temporary' }];
                if (report.missing.includes(offer)) return [offer, { message: 'Нет текущей цены ВБ', kind: 'data' }];
                if (report.belowMin.includes(offer))
                    return [offer, { message: 'Цена ВБ ниже нового минимума', kind: 'data' }];
                if (report.changes.some((c) => c.article === offer))
                    return [offer, { message: 'Изменена скидка ВБ; ожидается подтверждение цены', kind: 'temporary' }];
                return [offer, null];
            }),
        );
    }
}
