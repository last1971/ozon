import { Injectable } from '@nestjs/common';
import { WbPriceService } from '../../wb.price/wb.price.service';
import { WbCurrentPrice, WbCurrentPricesService } from '../../wb.price/wb.current-prices.service';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { wbPriceTask } from '../../wb.price/wb-price-task';
import { LossPriceAdapter } from './loss-price.contracts';

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
    matches(target: UpdatePriceDto, actual: unknown) {
        if (!actual) return false;
        const current = actual as WbCurrentPrice;
        const wanted = wbPriceTask(target, current.nmID);
        return Number.isFinite(current.price) && wanted.price === current.price && wanted.discount === current.discount;
    }
    persist(targets: UpdatePriceDto[]) {
        return this.pricing.saveMinPrices(targets);
    }
    async send(targets: UpdatePriceDto[]) {
        const response = await this.pricing.updatePrices(targets);
        const rows = new Map<string, { status: string; message?: string }>(
            (response?.results ?? []).map((r) => [r.offer_id, r]),
        );
        return new Map(
            targets.map((t): [string, string | null] => {
                const row = rows.get(t.offer_id);
                return [
                    t.offer_id,
                    row && ['accepted', 'unchanged'].includes(row.status)
                        ? null
                        : row?.message || 'ВБ не подтвердил приём цены',
                ];
            }),
        );
    }
    async promos(offers: string[]) {
        const report = await this.pricing.setMinPrices(offers);
        return new Map(
            offers.map((offer): [string, string | null] => [
                offer,
                report.errors.find((e) => e.startsWith(offer + ':')) ||
                    (report.missing.includes(offer)
                        ? 'Нет текущей цены ВБ'
                        : report.belowMin.includes(offer)
                          ? 'Цена ВБ ниже нового минимума'
                          : report.changes.some((c) => c.article === offer)
                            ? 'Изменена скидка ВБ; ожидается подтверждение цены'
                            : null),
            ]),
        );
    }
}
