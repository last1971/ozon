import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDisableGoodsContext } from './i.disable.goods.context';
import { GOOD_SERVICE, IGood } from '../../interfaces/IGood';

/** Пишет отключение в GOODS_DISABLED (durable). */
@Injectable()
export class WriteDisabledFlagCommand implements ICommandAsync<IDisableGoodsContext> {
    constructor(@Inject(GOOD_SERVICE) private readonly goodService: IGood) {}

    async execute(context: IDisableGoodsContext): Promise<IDisableGoodsContext> {
        await this.goodService.setGoodsDisabled(context.tokens ?? [], context.service);
        return context;
    }
}
