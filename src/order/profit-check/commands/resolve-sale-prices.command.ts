import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { ProfitCheckContext, ProfitCheckItem, SalePriceRef } from '../profit-check.types';
import { SalePriceSources } from '../sale-price.sources';

/**
 * 2. Наша цена по каждому заказу. Источник «заказ» — цена уже в записи. Источник «поиск» —
 * один запрос к площадке на все её заказы разом (у статистики ВБ лимит раз в минуту); чего не
 * нашлось — остаётся в очереди, пока не истечёт lookupHours, потом «не проверено».
 */
@Injectable()
export class ResolveSalePricesCommand implements ICommandAsync<ProfitCheckContext> {
    private readonly logger = new Logger(ResolveSalePricesCommand.name);

    constructor(private readonly sources: SalePriceSources) {}

    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const items = ctx.items.map((i) => ({ ...i }));
        const lookups = new Map<string, ProfitCheckItem[]>();
        for (const item of items) {
            if (item.payload.priceSource === 'posting') item.resolved = true;
            else if (item.payload.priceSource === 'lookup')
                lookups.set(item.payload.service, [...(lookups.get(item.payload.service) ?? []), item]);
            else {
                item.resolved = false;
                item.reason = 'площадка не отдаёт нашу цену';
            }
        }
        const deadline = Date.now() - ctx.lookupHours * 3600_000;
        for (const [service, group] of lookups) {
            const source = this.sources.of(service as any);
            const refs: SalePriceRef[] = group.map((i) => ({
                posting: i.posting,
                externalId: i.payload.externalId,
                since: i.firstSeen,
            }));
            let found = new Map<string, any>();
            try {
                found = source ? await source.lookupSalePrices(refs) : new Map();
            } catch (e) {
                this.logger.warn(`${service}: цены не получены — ${e.message}`);
            }
            for (const item of group) {
                const lines = found.get(item.payload.externalId);
                if (lines?.length) {
                    item.payload = { ...item.payload, lines };
                    item.resolved = true;
                } else if (item.firstSeen.getTime() < deadline) {
                    item.reason = `площадка не отдала нашу цену за ${ctx.lookupHours} ч`;
                } else {
                    item.deferred = true;
                }
            }
        }
        return { ...ctx, items };
    }
}
