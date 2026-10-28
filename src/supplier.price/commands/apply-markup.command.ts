import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ISupplierPriceContext } from '../interfaces/supplier.price.context';
import { SupplierPriceStrategyRegistry } from '../supplier.price.strategy.registry';
import {
    buildTiers,
    DEFAULT_TIER_THRESHOLDS,
    parseTierDefaults,
    PartyPriceDto,
    supplierThresholds,
    TierDefaultRow,
} from '../../helpers';

/**
 * Кирпич наценки: закупка + доставка → цена/зачёркнутая/минимальная. Ступени поставщика считаются той же
 * наценкой каждая как партия от `quantity` штук, затем buildTiers отбрасывает ступени дороже обычной
 * цены или дорожающие с количеством — как у наших товаров. Ниже первой ступени поставщика (или при одной цене)
 * ступени свои, по правилу наших товаров: пороги от розничной цены (SYLIUS_TIER_DEFAULTS); деталь с закупкой
 * до 1 ₽ — 10/100/1000 шт.
 * Кратность (товар продаётся только пачками): цена и страховка прибыли считаются на пачку и делятся на штуки
 * (владелец 28.10.2026: CBB61 по 10 шт показывал 44 ₽ за штуку при 34,15 ₽ за штуку в пачке); свои ступени —
 * только больше пачки.
 */
@Injectable()
export class ApplyMarkupCommand implements ICommandAsync<ISupplierPriceContext> {
    private readonly tierDefaults: TierDefaultRow[];

    constructor(
        private readonly registry: SupplierPriceStrategyRegistry,
        @Optional() configService?: ConfigService,
    ) {
        this.tierDefaults = parseTierDefaults(
            configService?.get<string>('SYLIUS_TIER_DEFAULTS', DEFAULT_TIER_THRESHOLDS) ?? DEFAULT_TIER_THRESHOLDS,
        );
    }

    async execute(context: ISupplierPriceContext): Promise<ISupplierPriceContext> {
        for (const item of context.items) {
            if (item.error) continue;
            const { supplier, code } = item.input;
            const markup = this.registry.get(supplier).markup;
            try {
                const unitCost = item.incomingRub + item.deliveryRub;
                const multiple = Math.max(1, Math.floor(item.input.multiple ?? 1));
                const main = perUnit(markup.apply(code, unitCost * multiple), multiple);
                // Ступень — одна продажа партии: закупка партии целиком, упаковка и этикетка один раз (как у наших
                // товаров в buildPriceables), buildTiers потом делит на количество
                // Свои пороги — только ниже первой ступени поставщика (Компэл даёт скидку от 7522 шт — до неё
                // 10/100/1000 по закупке за штуку); ступени поставщика остаются как есть
                const supplierTiers = item.tiersRub ?? [];
                const firstSupplierQuantity = Math.min(...supplierTiers.map((t) => t.quantity));
                const ownParties: PartyPriceDto[] = supplierThresholds(main.price, unitCost, this.tierDefaults)
                    .filter((quantity) => quantity < firstSupplierQuantity && quantity > multiple)
                    .map((quantity) => {
                        const party = markup.apply(code, unitCost * quantity);
                        return { quantity, price: party.price, min_price: party.min_price };
                    });
                const parties: PartyPriceDto[] = [
                    ...ownParties,
                    ...supplierTiers.map((t) => {
                        const party = markup.apply(code, (t.priceRub + item.deliveryRub) * t.quantity);
                        return { quantity: t.quantity, price: party.price, min_price: party.min_price };
                    }),
                ];
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

/** Цены пачки → за штуку, вверх до копейки; без кратности — как есть. */
function perUnit<T extends { price: number; old_price: number; min_price: number }>(party: T, multiple: number): T {
    if (multiple === 1) return party;
    const unit = (value: number) => Math.ceil(Math.round((value / multiple) * 1e6) / 1e4) / 100;
    return { ...party, price: unit(party.price), old_price: unit(party.old_price), min_price: unit(party.min_price) };
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
