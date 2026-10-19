import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { hasSalePriceFallback } from '../../../interfaces/IOrderable';
import { MpService } from '../../../mp-event/mp-event.service';
import { ProfitCheckContext, ProfitCheckItem } from '../profit-check.types';
import { SalePriceSources } from '../sale-price.sources';

/**
 * 2б. Запасная наша цена для заказов, по которым основной поиск сдался (expired). Площадка без запасного
 * источника — заказ остаётся «не проверено». Найденная цена помечается priceOrigin=card: она на момент
 * проверки, а не заказа, и сообщение об этом говорит.
 */
@Injectable()
export class FallbackSalePricesCommand implements ICommandAsync<ProfitCheckContext> {
    private readonly logger = new Logger(FallbackSalePricesCommand.name);

    constructor(private readonly sources: SalePriceSources) {}

    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const items = ctx.items.map((i) => ({ ...i }));
        const expired = new Map<MpService, ProfitCheckItem[]>();
        for (const item of items) {
            if (!item.expired || item.resolved) continue;
            expired.set(item.payload.service, [...(expired.get(item.payload.service) ?? []), item]);
        }
        for (const [service, group] of expired) {
            const source = this.sources.of(service);
            if (!hasSalePriceFallback(source)) continue;
            let found = new Map<string, any>();
            try {
                found = await source.fallbackSalePrices(
                    group.map((i) => ({ externalId: i.payload.externalId, lines: i.payload.lines })),
                );
            } catch (e) {
                this.logger.warn(`${service}: запасные цены не получены — ${e.message}`);
            }
            for (const item of group) {
                const lines = found.get(item.payload.externalId);
                if (!lines?.length) continue;
                item.payload = { ...item.payload, lines, priceOrigin: 'card' };
                item.resolved = true;
                item.expired = false;
                item.reason = undefined;
            }
        }
        return { ...ctx, items };
    }
}
