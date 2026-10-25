import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ISupplierPriceContext } from '../interfaces/supplier.price.context';
import { SupplierPriceStrategyRegistry } from '../supplier.price.strategy.registry';

/** Кирпич доставки: рублей за штуку сверх закупки, по классу поставщика. */
@Injectable()
export class AddDeliveryCommand implements ICommandAsync<ISupplierPriceContext> {
    constructor(private readonly registry: SupplierPriceStrategyRegistry) {}

    async execute(context: ISupplierPriceContext): Promise<ISupplierPriceContext> {
        for (const item of context.items) {
            if (item.error) continue;
            const strategy = this.registry.get(item.input.supplier).delivery;
            item.deliveryRub = strategy.costRub(item.incomingRub, item.input.code);
        }
        return context;
    }
}
