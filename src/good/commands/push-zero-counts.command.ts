import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDisableGoodsContext } from './i.disable.goods.context';
import { ExtraGoodService } from '../extra.good.service';

/** Мгновенный эффект отключения: пушит stock:0 для affectedSkus. */
@Injectable()
export class PushZeroCountsCommand implements ICommandAsync<IDisableGoodsContext> {
    constructor(
        @Inject(forwardRef(() => ExtraGoodService))
        private readonly extraGoodService: ExtraGoodService,
    ) {}

    async execute(context: IDisableGoodsContext): Promise<IDisableGoodsContext> {
        const count = await this.extraGoodService.zeroBalances(context.service, context.affectedSkus ?? []);
        return { ...context, count };
    }
}
