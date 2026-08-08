import { Injectable } from "@nestjs/common";
import { ICountUpdateable } from "../../interfaces/ICountUpdatebale";
import { GoodDto } from "../../good/dto/good.dto";
import { GoodServiceEnum } from "../../good/good.service.enum";
import { skusToGoodIds } from "../index";
import { CommandChainAsync } from "../command/command.chain.async";
import { IGoodsCountContext } from "./commands/i.goods.count.context";
import { LoadSnapshotCommand } from "./commands/load-snapshot.command";
import { MapSkusToGoodsCommand } from "./commands/map-skus-to-goods.command";
import { DistributePlainCountsCommand } from "./commands/distribute-plain-counts.command";
import { DistributeMarkedCountsCommand } from "./commands/distribute-marked-counts.command";
import { ApplyDisabledCommand } from "./commands/apply-disabled.command";
import { KeepChangedOnlyCommand } from "./commands/keep-changed-only.command";
import { PushCountsCommand } from "./commands/push-counts.command";

/** Карта маркетплейсов, которую держит ExtraGoodService. */
export type CountUpdateableServices = Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>;

/**
 * Пересчёт остатков для маркетов. Сам ничего не считает — собирает контекст на КАЖДЫЙ сервис
 * (набор фасовок у маркетов разный) и прогоняет цепочку команд.
 */
@Injectable()
export class GoodsCountProcessor {
    constructor(
        private readonly loadSnapshotCommand: LoadSnapshotCommand,
        private readonly mapSkusToGoodsCommand: MapSkusToGoodsCommand,
        private readonly distributePlainCountsCommand: DistributePlainCountsCommand,
        private readonly distributeMarkedCountsCommand: DistributeMarkedCountsCommand,
        private readonly applyDisabledCommand: ApplyDisabledCommand,
        private readonly keepChangedOnlyCommand: KeepChangedOnlyCommand,
        private readonly pushCountsCommand: PushCountsCommand,
    ) {}

    private chain(): CommandChainAsync<IGoodsCountContext> {
        return new CommandChainAsync<IGoodsCountContext>([
            this.loadSnapshotCommand,
            this.mapSkusToGoodsCommand,
            this.distributePlainCountsCommand,
            this.distributeMarkedCountsCommand,
            this.applyDisabledCommand,
            this.keepChangedOnlyCommand,
            this.pushCountsCommand,
        ]);
    }

    private newContext(
        serviceKey: GoodServiceEnum,
        service: ICountUpdateable,
        rest: Partial<IGoodsCountContext>,
    ): IGoodsCountContext {
        return {
            serviceKey,
            service,
            goods: [],
            disabled: new Set<string>(),
            markedGoods: new Set<string>(),
            freeByGood: new Map(),
            filteredSkuMap: new Map(),
            counts: new Map<string, number>(),
            updated: 0,
            ...rest,
        };
    }

    /** Событийный путь: товары уже известны (изменился остаток или резерв). */
    async processGoodsCountChanges(services: CountUpdateableServices, goods: GoodDto[]): Promise<void> {
        for (const [key, { service, isSwitchedOn }] of services) {
            if (!isSwitchedOn) continue;
            await this.chain().execute(this.newContext(key, service, { goods }));
        }
    }

    /** Крон-путь: маркет отдаёт свои остатки страницами, сверяем и шлём только изменения. */
    async processGoodsCountForService(
        services: CountUpdateableServices,
        marketService: GoodServiceEnum,
        args: any,
    ): Promise<number> {
        const { service, isSwitchedOn } = services.get(marketService);

        // Если сервис выключен, пропускаем
        if (!isSwitchedOn) return 0;

        const serviceGoods = await service.getGoodIds(args);
        const goodIds = skusToGoodIds(Array.from(serviceGoods.goods.keys()));

        let updatedCount = 0;
        if (goodIds.length > 0) {
            const context = await this.chain().execute(
                this.newContext(marketService, service, { goodIds, currentCounts: serviceGoods.goods }),
            );
            updatedCount = context.updated;
        }

        // Следующая порция, если есть
        if (serviceGoods.nextArgs) {
            return updatedCount + (await this.processGoodsCountForService(services, marketService, serviceGoods.nextArgs));
        }

        return updatedCount;
    }
}
