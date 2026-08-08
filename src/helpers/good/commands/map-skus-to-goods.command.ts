import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';

/** Сопоставляет товарам их SKU на этом сервисе: GOODSCODE → список фасовок. */
@Injectable()
export class MapSkusToGoodsCommand implements ICommandAsync<IGoodsCountContext> {
    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        const filteredSkuMap = new Map<string, string[]>();

        context.goods.forEach((good) => {
            filteredSkuMap.set(
                String(good.code),
                context.service.skuList.filter((sku) => sku.includes(String(good.code))),
            );
        });

        return { ...context, filteredSkuMap };
    }
}
