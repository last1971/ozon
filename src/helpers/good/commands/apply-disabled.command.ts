import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';
import { isDisabled } from '../../index';

/** Отключённые на маркете товары и фасовки (GOODS_DISABLED) уходят в 0 поверх любого расчёта. */
@Injectable()
export class ApplyDisabledCommand implements ICommandAsync<IGoodsCountContext> {
    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        if (context.disabled.size === 0) return context;

        const counts = new Map(context.counts);
        for (const sku of counts.keys()) {
            if (isDisabled(sku, context.disabled)) counts.set(sku, 0);
        }

        return { ...context, counts };
    }
}
