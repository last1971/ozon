import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDisableGoodsContext } from './i.disable.goods.context';
import { ExtraGoodService } from '../extra.good.service';
import { GOOD_SERVICE, IGood } from '../../interfaces/IGood';
import { goodCode } from '../../helpers';

/**
 * После снятия отключения возвращает реальный склад: пересчитывает товары
 * (countsChanged) — так же, как это делает крон при изменении остатка.
 */
@Injectable()
export class RestoreCountsCommand implements ICommandAsync<IDisableGoodsContext> {
    constructor(
        @Inject(forwardRef(() => ExtraGoodService))
        private readonly extraGoodService: ExtraGoodService,
        @Inject(GOOD_SERVICE) private readonly goodService: IGood,
    ) {}

    async execute(context: IDisableGoodsContext): Promise<IDisableGoodsContext> {
        const goodCodes = [...new Set((context.tokens ?? []).map((token) => goodCode({ offer_id: token })))];
        if (goodCodes.length === 0) return context;
        const goods = await this.goodService.in(goodCodes, null);
        await this.extraGoodService.countsChanged(goods);
        return { ...context, count: goods.length };
    }
}
