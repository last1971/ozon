import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDisableGoodsContext } from './i.disable.goods.context';
import { ExtraGoodService } from '../extra.good.service';
import { encodeDisabled, goodCode } from '../../helpers';

/**
 * Чистит вход (trim, дедуп) и раскладывает по режиму level:
 *  - tokens — что писать в GOODS_DISABLED (закодировано: good-блок с префиксом, sku-блок как есть);
 *  - affectedSkus — какие SKU сразу обнулить (для good — все текущие фасовки товара).
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

        const tokens = clean.map((code) => encodeDisabled(code, context.level));

        const affectedSkus =
            context.level === 'sku'
                ? clean
                : this.extraGoodService
                      .getSkuList(context.service)
                      .filter((sku) => clean.includes(goodCode({ offer_id: sku })));

        return { ...context, tokens, affectedSkus };
    }
}
