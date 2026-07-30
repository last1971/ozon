import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDisableGoodsContext } from './i.disable.goods.context';
import { ExtraGoodService } from '../extra.good.service';
import { goodCode } from '../../helpers';

/**
 * Чистит вход и раскладывает его на:
 *  - tokens — что писать в GOODS_DISABLED (сам SKU при exact, иначе goodCode);
 *  - affectedSkus — какие SKU пушить в маркет.
 * Пустой ввод → stopChain.
 */
@Injectable()
export class ResolveDisableTokensCommand implements ICommandAsync<IDisableGoodsContext> {
    constructor(
        @Inject(forwardRef(() => ExtraGoodService))
        private readonly extraGoodService: ExtraGoodService,
    ) {}

    async execute(context: IDisableGoodsContext): Promise<IDisableGoodsContext> {
        const clean = [...new Set((context.inputSkus ?? []).map((s) => s.trim()).filter(Boolean))];
        if (clean.length === 0) {
            return {
                ...context,
                tokens: [],
                affectedSkus: [],
                stopChain: true,
                errors: [...(context.errors ?? []), `Не передано ни одного SKU для ${context.service}`],
            };
        }

        const tokens = context.exact
            ? clean
            : [...new Set(clean.map((sku) => goodCode({ offer_id: sku })))];

        const affectedSkus = context.exact
            ? clean
            : this.extraGoodService
                  .getSkuList(context.service)
                  .filter((sku) => tokens.includes(goodCode({ offer_id: sku })));

        return { ...context, tokens, affectedSkus };
    }
}
