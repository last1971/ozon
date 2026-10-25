import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ISupplierPriceContext } from '../interfaces/supplier.price.context';
import { SupplierPriceStrategyRegistry } from '../supplier.price.strategy.registry';

/** Строки с неизвестным поставщиком или без цены — в ошибки, остальные идут дальше. Пустая пачка — стоп. */
@Injectable()
export class ValidateBatchCommand implements ICommandAsync<ISupplierPriceContext> {
    constructor(private readonly registry: SupplierPriceStrategyRegistry) {}

    async execute(context: ISupplierPriceContext): Promise<ISupplierPriceContext> {
        for (const item of context.items) {
            const { supplier, price } = item.input;
            if (!this.registry.get(supplier)) {
                item.error = `неизвестный поставщик «${supplier}» (есть: ${this.registry.aliases().join(', ')})`;
            } else if (!Number.isFinite(price) || price <= 0) {
                item.error = `цена поставщика не число или 0: ${price}`;
            }
        }
        if (context.items.every((i) => i.error)) {
            context.logger?.warn('Пачка цен поставщиков: ни одной годной строки');
            context.stopChain = true;
        }
        return context;
    }
}
