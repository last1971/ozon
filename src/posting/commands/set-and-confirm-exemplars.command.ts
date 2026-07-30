import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';
import { ExemplarStatusResponseDto } from '../dto/exemplar.status.dto';
import { pollUntil, PollDecision } from '../../helpers/poll.util';

/**
 * Шаг 3: set экземпляров → подтверждение статуса.
 * set вернул false → не верим, спрашиваем фактическое состояние (allPassed → успех).
 * set ok → poll до ship_available. (Ship добавляется в 2b.)
 */
@Injectable()
export class SetAndConfirmExemplarsCommand implements ICommandAsync<IFbsSubmitContext> {
    private readonly logger = new Logger(SetAndConfirmExemplarsCommand.name);

    constructor(@Inject(forwardRef(() => PostingService)) private readonly postingService: PostingService) {}

    async execute(ctx: IFbsSubmitContext): Promise<IFbsSubmitContext> {
        const setReq = {
            posting_number: ctx.postingNumber,
            multi_box_qty: ctx.multiBoxQty || 1,
            products: ctx.setProducts,
        };
        this.logger.log(`[km ${ctx.postingNumber}] set req=${JSON.stringify(setReq)}`);
        const setResp = await this.postingService.setExemplars(setReq);
        this.logger.log(`[km ${ctx.postingNumber}] set resp=${JSON.stringify(setResp)}`);

        if (!setResp?.result) {
            const status = await this.postingService.getExemplarStatus(ctx.postingNumber);
            const allPassed =
                (status?.products?.length ?? 0) > 0 &&
                status.products.every((p) =>
                    p.exemplars?.every((e) => e.marks?.every((m) => m.check_status === 'passed')),
                );
            this.logger.warn(
                `[km ${ctx.postingNumber}] set=false; overall=${status?.status}; allPassed=${allPassed}`,
            );
            ctx.stopChain = true;
            ctx.result = allPassed
                ? { ok: true }
                : {
                      ok: false,
                      failedStep: 'set',
                      goToOzon: true,
                      failed: [
                          ...ctx.failed,
                          { ki: '*', reason: `setExemplars result=false; status=${status?.status}` },
                      ],
                  };
            return ctx;
        }

        const pollRes = await pollUntil<ExemplarStatusResponseDto>(
            () => this.postingService.getExemplarStatus(ctx.postingNumber),
            (v): PollDecision => {
                if (v?.status === 'ship_available') return 'done';
                if (v?.status === 'ship_not_available') return 'fail';
                return 'continue';
            },
        );
        if (pollRes.status !== 'done') {
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failedStep: 'status',
                goToOzon: true,
                failed: [
                    ...ctx.failed,
                    { ki: '*', reason: `polling ${pollRes.status} (last=${pollRes.value?.status})` },
                ],
            };
            return ctx;
        }

        // Частичный провал по строкам — не шипим, отдаём как есть.
        if (ctx.failed.length > 0) {
            ctx.stopChain = true;
            ctx.result = { ok: false, failed: ctx.failed };
            return ctx;
        }
        // Полный успех set+status — марки/ГТД на месте, идём к ship (следующая команда).
        return ctx;
    }
}
