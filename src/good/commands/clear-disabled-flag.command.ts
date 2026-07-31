import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDisableGoodsContext } from './i.disable.goods.context';
import { GOOD_SERVICE, IGood } from '../../interfaces/IGood';

/** Снимает отключение из GOODS_DISABLED. */
@Injectable()
export class ClearDisabledFlagCommand implements ICommandAsync<IDisableGoodsContext> {
    constructor(@Inject(GOOD_SERVICE) private readonly goodService: IGood) {}

    async execute(context: IDisableGoodsContext): Promise<IDisableGoodsContext> {
        await this.goodService.clearGoodsDisabled(context.tokens ?? [], context.service);
        return context;
    }
}
