import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';

/** Отправляет посчитанные остатки на маркет. */
@Injectable()
export class PushCountsCommand implements ICommandAsync<IGoodsCountContext> {
    private readonly logger = new Logger(PushCountsCommand.name);

    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        if (context.counts.size === 0) return { ...context, updated: 0 };

        const updated = await context.service.updateGoodCounts(context.counts);
        this.logger.log(`Updated ${updated} SKUs in ${context.serviceKey}`);

        return { ...context, updated };
    }
}
