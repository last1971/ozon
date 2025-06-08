import { Logger } from "@nestjs/common";
import { GoodCountsDto, ICountUpdateable } from "../../interfaces/ICountUpdatebale";
import { GoodDto } from "../../good/dto/good.dto";
import { GoodServiceEnum } from "../../good/good.service.enum";
import { goodQuantityCoeff, skusToGoodIds } from "../index";
import { IGood } from "../../interfaces/IGood";

export class GoodsCountProcessor {
    private quantityCache = new Map<string, number>();
    constructor(
        // Cписок всех сервисов
        private services: Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>,
        private logger: Logger // Логгер для сообщений
    ) {}

    async processGoodsCountChanges(goods: GoodDto[]): Promise<void> {
        //const quantityCache = new Map<string, number>();

        for (const { key, service } of this.getActiveServices()) {
            const filteredSkuMap = this.precomputeFilteredSkus(goods, service.skuList);

            const skusToUpdate= this.processGoods(goods, filteredSkuMap);

            // Обновляем сервис, если есть изменения
            await this.updateServiceWithSkus(service, skusToUpdate, key);
        }
    }

    async processGoodsCountForService(marketService: GoodServiceEnum, goodService: IGood, args: any): Promise<number> {
        const { service, isSwitchedOn } = this.services.get(marketService);

        // Если сервис выключен, пропускаем
        if (!isSwitchedOn) return 0;


        // 1. Получаем данные от сервиса
        const serviceGoods = await service.getGoodIds(args);

        // 2. Рассчитываем обновления
        const updateGoods = await this.calculateUpdatedGoods(serviceGoods, goodService, service.skuList);

        // 3. Обновляем данные в сервисе
        const updatedCount = await this.updateServiceWithSkus(service, updateGoods, marketService);

        // 4. Рекурсивно обрабатываем следующую порцию, если есть
        if (serviceGoods.nextArgs) {
            return updatedCount + (await this.processGoodsCountForService(marketService, goodService, serviceGoods.nextArgs));
        }

        return updatedCount;
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
    ): Map<string, number> {
        const skusToUpdate = new Map<string, number>();

        for (const good of goods) {
            const filteredSkus = filteredSkuMap.get(good.code) || [];

            if (filteredSkus.some((sku) => !this.quantityCache.has(sku))) {
                const distributedQuantities = this.distributeGoodQuantities(filteredSkus, good);

                // Обновляем только локальный кэш
                distributedQuantities.forEach((quantity, sku) => {
                    this.quantityCache.set(sku, quantity);
                });
            }

            filteredSkus.forEach((sku) => skusToUpdate.set(sku, this.quantityCache.get(sku)));
        }

        return skusToUpdate;
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
    ): Promise<number> {
        let updatedCount = 0;
        if (skusToUpdate.size > 0) {
            updatedCount = await service.updateGoodCounts(skusToUpdate);
            this.logger.log(`Updated ${updatedCount} SKUs in ${key}`);
        }
        return updatedCount;
    }

    private async calculateUpdatedGoods(
        serviceGoods: GoodCountsDto<number>,
        goodService: IGood,
        skuList: string[]
    ): Promise<Map<string, number>> {
        const updateGoods = new Map<string, number>();
        const goodIds: string[] = skusToGoodIds(Array.from(serviceGoods.goods.keys()));

        if (goodIds.length === 0) return updateGoods;

        const goods = await goodService.in(goodIds, null);
        const filteredSkuMap = this.precomputeFilteredSkus(goods, skuList);
        const calculatedGoods = this.processGoods(goods, filteredSkuMap);

        // Сравниваем текущие и новые данные
        for (const [id, currentCount] of serviceGoods.goods) {
            const newCount = calculatedGoods.get(id) || 0;
            if (currentCount !== newCount) {
                updateGoods.set(id, newCount);
            }
        }

        return updateGoods;
    }

}