import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ISupplierPriceContext } from '../interfaces/supplier.price.context';
import { SupplierPriceStrategyRegistry } from '../supplier.price.strategy.registry';
import { buildTiers, PartyPriceDto } from '../../helpers';

/**
 * Кирпич наценки: закупка + доставка → цена/зачёркнутая/минимальная. Ступени поставщика считаются той же
 * наценкой каждая как партия от `quantity` штук, затем buildTiers отбрасывает ступени дороже обычной
 * цены или дорожающие с количеством — как у наших товаров.
 */
@Injectable()
export class ApplyMarkupCommand implements ICommandAsync<ISupplierPriceContext> {
    constructor(private readonly registry: SupplierPriceStrategyRegistry) {}

    async execute(context: ISupplierPriceContext): Promise<ISupplierPriceContext> {
        for (const item of context.items) {
            if (item.error) continue;
            const { supplier, code } = item.input;
            const markup = this.registry.get(supplier).markup;
            try {
                const main = markup.apply(code, item.incomingRub + item.deliveryRub);
                // Ступень — одна продажа партии: закупка партии целиком, упаковка и этикетка один раз (как у наших
                // товаров в buildPriceables), buildTiers потом делит на количество
                const parties: PartyPriceDto[] = (item.tiersRub ?? []).map((t) => {
                    const party = markup.apply(code, (t.priceRub + item.deliveryRub) * t.quantity);
                    return { quantity: t.quantity, price: party.price, min_price: party.min_price };
                });
                const { tiers, dropped } = buildTiers(Math.round(main.price * 100), parties);
                if (dropped.length > 0) {
                    context.logger?.log(
                        `${supplier} ${code}: ступени отброшены ${dropped.map((d) => `${d.quantity} (${d.reason})`).join('; ')}`,
                    );
                }
                item.result = {
                    supplier,
                    code,
                    incoming_price: round2(item.incomingRub),
                    delivery: round2(item.deliveryRub),
                    ...main,
                    tiers: tiers.map((t) => ({ quantity: t.quantity, price: t.price / 100 })),
                };
            } catch (e) {
                item.error = `наценка: ${e.message}`;
            }
        }
        return context;
    }
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
