import { Logger } from "@nestjs/common";
import { ICountUpdateable } from "../interfaces/ICountUpdatebale";
import { GoodDto } from "../good/dto/good.dto";
import { GoodServiceEnum } from "../good/good.service.enum";
import { goodQuantityCoeff } from "./index";

export class GoodsCountProcessor {
    constructor(
        // Cписок всех сервисов
        private services: Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>,
        private logger: Logger // Логгер для сообщений
    ) {}

    async processGoodsCountChanges(goods: GoodDto[]): Promise<void> {
        const quantityCache = new Map<string, number>();

        for (const { key, service } of this.getActiveServices()) {
            const filteredSkuMap = this.precomputeFilteredSkus(goods, service.skuList);

            const { skusToUpdate, updatedCache } = this.processGoods(
                goods,
                filteredSkuMap,
                quantityCache
            );

            // Обновляем глобальный кэш
            updatedCache.forEach((quantity, sku) => {
                quantityCache.set(sku, quantity);
            });

            // Обновляем сервис, если есть изменения
            await this.updateServiceWithSkus(service, skusToUpdate, key);
        }
    }

    // Список активных сервисов
    private getActiveServices(): Array<{ key: string; service: ICountUpdateable }> {
        return Array.from(this.services.entries())
            .filter(([_, service]) => service.isSwitchedOn)
            .map(([key, service]) => ({ key, service: service.service }));
    }

    // Для каждого товара создаем список SKU относящихся к нему
    private precomputeFilteredSkus(goods: GoodDto[], skuList: string[]): Map<string, string[]> {
        const filteredSkuMap = new Map<string, string[]>();

        goods.forEach((good) => {
            const filteredSkus = skuList.filter((sku) => sku.includes(good.code));
            filteredSkuMap.set(good.code, filteredSkus);
        });

        return filteredSkuMap;
    }

    private processGoods(
        goods: GoodDto[],
        filteredSkuMap: Map<string, string[]>,
        quantityCache: Map<string, number>
    ): { skusToUpdate: Map<string, number>; updatedCache: Map<string, number> } {
        const skusToUpdate = new Map<string, number>();
        const localCache = new Map<string, number>(quantityCache);

        for (const good of goods) {
            const filteredSkus = filteredSkuMap.get(good.code) || [];

            if (filteredSkus.some((sku) => !localCache.has(sku))) {
                const distributedQuantities = this.distributeGoodQuantities(filteredSkus, good);

                // Обновляем только локальный кэш
                distributedQuantities.forEach((quantity, sku) => {
                    localCache.set(sku, quantity);
                });
            }

            filteredSkus.forEach((sku) => skusToUpdate.set(sku, localCache.get(sku)));
        }

        return { skusToUpdate, updatedCache: localCache };
    }

    private distributeGoodQuantities(filteredSkus: string[], good: GoodDto): Map<string, number> {
        const remainingQuantity = good.quantity - (good.reserve ?? 0);

        const distributedQuantities = this.distributeGoods(
            remainingQuantity,
            filteredSkus.map((sku) => ({
                sku,
                coefficient: goodQuantityCoeff({ offer_id: sku }),
            }))
        );

        return new Map(Object.entries(distributedQuantities));
    }

    private distributeGoods(totalQuantity: number, skus: { sku: string; coefficient: number }[]): { [key: string]: number } {
        const totalCoefficient = skus.reduce((sum, { coefficient }) => sum + coefficient, 0);
        const distribution: { [key: string]: number } = {};
        let allocated = 0;

        // Шаг 1: Пропорциональное распределение
        skus.forEach(({ sku, coefficient }) => {
            const proportion = (totalQuantity * coefficient) / totalCoefficient;
            const scaledUnits = Math.floor(proportion / coefficient);
            distribution[sku] = scaledUnits;
            allocated += scaledUnits * coefficient;
        });

        // Шаг 2: Распределение остатка
        let remaining = totalQuantity - allocated;

        for (const { sku, coefficient } of skus.sort((a, b) => b.coefficient - a.coefficient)) {
            while (remaining >= coefficient) {
                distribution[sku] += 1;
                remaining -= coefficient;
            }
        }

        return distribution;
    }

    private async updateServiceWithSkus(
        service: ICountUpdateable,
        skusToUpdate: Map<string, number>,
        key: string
    ): Promise<void> {
        if (skusToUpdate.size > 0) {
            const updatedCount = await service.updateGoodCounts(skusToUpdate);
            this.logger.log(`Updated ${updatedCount} SKUs in ${key}`);
        }
    }
}