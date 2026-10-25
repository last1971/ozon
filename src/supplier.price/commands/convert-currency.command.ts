import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ISupplierPriceContext } from '../interfaces/supplier.price.context';
import { SupplierPriceStrategyRegistry } from '../supplier.price.strategy.registry';

/** Кирпич валюты: цена и ступени поставщика → рубли за штуку. */
@Injectable()
export class ConvertCurrencyCommand implements ICommandAsync<ISupplierPriceContext> {
    constructor(private readonly registry: SupplierPriceStrategyRegistry) {}

    async execute(context: ISupplierPriceContext): Promise<ISupplierPriceContext> {
        for (const item of context.items) {
            if (item.error) continue;
            const { supplier, price, currency, tiers } = item.input;
            const strategy = this.registry.get(supplier).currency;
            try {
                item.incomingRub = strategy.toRub(price, currency, context.rates);
                item.tiersRub = (tiers ?? []).map((t) => ({
                    quantity: t.quantity,
                    priceRub: strategy.toRub(t.price, currency, context.rates),
                }));
            } catch (e) {
                item.error = `валюта: ${e.message}`;
            }
        }
        return context;
    }
}
