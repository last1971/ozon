import { Injectable } from '@nestjs/common';
import { ISupplierCurrency } from './strategies/i.supplier.currency';
import { ISupplierDelivery } from './strategies/i.supplier.delivery';
import { ISupplierMarkup } from './strategies/i.supplier.markup';
import { CbrPlusPercentCurrency } from './strategies/cbr.plus.percent.currency';
import { CompelDeliveryCost } from './strategies/compel.delivery.cost';
import { CompelMarkup } from './strategies/compel.markup';
import { RubAsIsCurrency } from './strategies/rub.as.is.currency';
import { RuelectronicsDeliveryCost } from './strategies/ruelectronics.delivery.cost';
import { RuelectronicsMarkup } from './strategies/ruelectronics.markup';

export interface SupplierPriceStrategies {
    currency: ISupplierCurrency;
    delivery: ISupplierDelivery;
    markup: ISupplierMarkup;
}

/**
 * Набор кирпичей по alias поставщика. Новый поставщик — новая строка здесь и свои классы (или общая
 * DefaultMarkup); чужие наборы не меняются. Неизвестный alias — null, строка уходит в ошибки.
 */
@Injectable()
export class SupplierPriceStrategyRegistry {
    private readonly strategies: Map<string, SupplierPriceStrategies>;

    constructor(compelMarkup: CompelMarkup, ruelectronicsMarkup: RuelectronicsMarkup) {
        this.strategies = new Map<string, SupplierPriceStrategies>([
            [
                'compel',
                {
                    currency: new CbrPlusPercentCurrency(2),
                    delivery: new CompelDeliveryCost(),
                    markup: compelMarkup,
                },
            ],
            [
                // Цена — VIP (наша закупка) в рублях с НДС; её выбирает сайт (владелец 28.10.2026)
                'ruelectronics',
                {
                    currency: new RubAsIsCurrency(),
                    delivery: new RuelectronicsDeliveryCost(),
                    markup: ruelectronicsMarkup,
                },
            ],
        ]);
    }

    get(supplier: string): SupplierPriceStrategies | null {
        return this.strategies.get(supplier.toLowerCase()) ?? null;
    }

    aliases(): string[] {
        return [...this.strategies.keys()];
    }
}
