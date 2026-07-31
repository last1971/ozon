import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';

/** Шаг 1: create-or-get экземпляров. Пустой ответ → обрыв цепочки (skipRetry). */
@Injectable()
export class CreateOrGetExemplarsCommand implements ICommandAsync<IFbsSubmitContext> {
    constructor(@Inject(forwardRef(() => PostingService)) private readonly postingService: PostingService) {}

    async execute(ctx: IFbsSubmitContext): Promise<IFbsSubmitContext> {
        const exResp = await this.postingService.createOrGetExemplars(ctx.postingNumber);
        if (!exResp || !exResp.products) {
            const reason = (exResp as any)?.error?.message ?? 'createOrGet вернул пустой ответ';
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failed: [{ ki: '*', reason }],
                skipRetry: true,
            };
            return ctx;
        }
        ctx.exResp = exResp;
        ctx.multiBoxQty = exResp.multi_box_qty || 1;
        return ctx;
    }
}
