import { Inject, Injectable, Logger } from "@nestjs/common";
import { GoodCountsDto, ICountUpdateable } from "../../interfaces/ICountUpdatebale";
import { GoodDto } from "../../good/dto/good.dto";
import { GoodServiceEnum } from "../../good/good.service.enum";
import { goodQuantityCoeff, isDisabled, skusToGoodIds } from "../index";
import { GOOD_SERVICE, IGood } from "../../interfaces/IGood";

/** Карта маркетплейсов, которую держит ExtraGoodService. */
export type CountUpdateableServices = Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>;

/**
 * Состояние одного пересчёта. Раньше кэши лежали на инстансе — процессор создавался
 * через `new` на каждый вызов. Теперь он провайдер (один на приложение), поэтому кэши
 * живут ровно столько, сколько идёт один пересчёт, и между вызовами не протекают.
 */
interface RunState {
    // Посчитанные количества по SKU.
    quantityCache: Map<string, number>;
    // Ленивый кэш отключённых кодов по сервису.
    disabledCache: Map<string, Set<string>>;
}

@Injectable()
export class GoodsCountProcessor {
    private readonly logger = new Logger(GoodsCountProcessor.name);

    // Источник флагов «товар отключён на маркете» (GOODS_DISABLED) и данных о товарах.
    constructor(@Inject(GOOD_SERVICE) private readonly goodService: IGood) {}

    private newState(): RunState {
        return { quantityCache: new Map<string, number>(), disabledCache: new Map<string, Set<string>>() };
    }

    /** Set отключённых кодов (GOODSCODE или SKU) для сервиса. Кэшируется на время пересчёта. */
    private async getDisabled(state: RunState, serviceKey: GoodServiceEnum | string): Promise<Set<string>> {
        const cacheKey = String(serviceKey);
        if (!state.disabledCache.has(cacheKey)) {
            const codes = await this.goodService.getDisabledCodes(serviceKey as GoodServiceEnum);
            state.disabledCache.set(cacheKey, new Set(codes));
        }
        return state.disabledCache.get(cacheKey);
    }

    async processGoodsCountChanges(services: CountUpdateableServices, goods: GoodDto[]): Promise<void> {
        const state = this.newState();

        for (const { key, service } of this.getActiveServices(services)) {
            const disabled = await this.getDisabled(state, key);
            const filteredSkuMap = this.precomputeFilteredSkus(goods, service.skuList);

            const skusToUpdate = this.processGoods(state, goods, filteredSkuMap, disabled);

            // Обновляем сервис, если есть изменения
            await this.updateServiceWithSkus(service, skusToUpdate, key);
        }
    }

    async processGoodsCountForService(
        services: CountUpdateableServices,
        marketService: GoodServiceEnum,
        args: any,
    ): Promise<number> {
        return this.processForService(this.newState(), services, marketService, args);
    }

    private async processForService(
        state: RunState,
        services: CountUpdateableServices,
        marketService: GoodServiceEnum,
        args: any,
    ): Promise<number> {
        const { service, isSwitchedOn } = services.get(marketService);

        // Если сервис выключен, пропускаем
        if (!isSwitchedOn) return 0;

        // 1. Получаем данные от сервиса
        const serviceGoods = await service.getGoodIds(args);

        // 2. Рассчитываем обновления
        const updateGoods = await this.calculateUpdatedGoods(state, serviceGoods, service.skuList, marketService);

        // 3. Обновляем данные в сервисе
        const updatedCount = await this.updateServiceWithSkus(service, updateGoods, marketService);

        // 4. Рекурсивно обрабатываем следующую порцию, если есть
        if (serviceGoods.nextArgs) {
            return updatedCount + (await this.processForService(state, services, marketService, serviceGoods.nextArgs));
        }

        return updatedCount;
    }

    // Список активных сервисов
    private getActiveServices(services: CountUpdateableServices): Array<{ key: string; service: ICountUpdateable }> {
        return Array.from(services.entries())
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
        state: RunState,
        goods: GoodDto[],
        filteredSkuMap: Map<string, string[]>,
        disabled: Set<string> = new Set(),
    ): Map<string, number> {
        const skusToUpdate = new Map<string, number>();

        for (const good of goods) {
            const filteredSkus = filteredSkuMap.get(good.code) || [];

            if (filteredSkus.some((sku) => !state.quantityCache.has(sku))) {
                const distributedQuantities = this.distributeGoodQuantities(filteredSkus, good);

                // Обновляем только локальный кэш
                distributedQuantities.forEach((quantity, sku) => {
                    state.quantityCache.set(sku, quantity);
                });
            }

            // Блок по точному SKU или по гудскоде — решает isDisabled (единый формат из хелпера).
            filteredSkus.forEach((sku) => {
                skusToUpdate.set(sku, isDisabled(sku, disabled) ? 0 : state.quantityCache.get(sku));
            });
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
        state: RunState,
        serviceGoods: GoodCountsDto<number>,
        skuList: string[],
        marketService: GoodServiceEnum,
    ): Promise<Map<string, number>> {
        const updateGoods = new Map<string, number>();
        const goodIds: string[] = skusToGoodIds(Array.from(serviceGoods.goods.keys()));

        if (goodIds.length === 0) return updateGoods;

        const goods = await this.goodService.in(goodIds, null);
        const filteredSkuMap = this.precomputeFilteredSkus(goods, skuList);
        const disabled = await this.getDisabled(state, marketService);
        const calculatedGoods = this.processGoods(state, goods, filteredSkuMap, disabled);

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
