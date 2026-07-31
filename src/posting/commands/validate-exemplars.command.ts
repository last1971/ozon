import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';

/**
 * Шаг перед set: сухая проверка марок+ГТД (/v5/.../exemplar/validate).
 * Невалидно → обрыв цепочки. Ошибка ДО set → НЕ goToOzon (в Озон ещё ничего не ушло).
 */
@Injectable()
export class ValidateExemplarsCommand implements ICommandAsync<IFbsSubmitContext> {
    private readonly logger = new Logger(ValidateExemplarsCommand.name);

    constructor(@Inject(forwardRef(() => PostingService)) private readonly postingService: PostingService) {}

    async execute(ctx: IFbsSubmitContext): Promise<IFbsSubmitContext> {
        const resp = await this.postingService.validateExemplars(ctx.postingNumber, ctx.setProducts);
        this.logger.log(`[km ${ctx.postingNumber}] validate resp=${JSON.stringify(resp)}`);

        // Грубая ошибка контракта: code/message вместо products.
        if (!resp?.products || resp.products.length === 0) {
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failedStep: 'validate',
                failed: [
                    ...ctx.failed,
                    { ki: '*', reason: `validate: ${(resp as any)?.error?.message ?? resp?.message ?? 'пустой ответ'}` },
                ],
            };
            return ctx;
        }

        const errors: string[] = [];
        for (const p of resp.products) {
            if (p.error) errors.push(`product ${p.product_id}: ${p.error}`);
            for (const ex of p.exemplars ?? []) {
                for (const e of ex.errors ?? []) errors.push(`product ${p.product_id}: ${e}`);
                for (const m of ex.marks ?? []) {
                    for (const e of m.errors ?? []) errors.push(`product ${p.product_id} mark: ${e}`);
                }
            }
        }

        if (errors.length > 0) {
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failedStep: 'validate',
                failed: [...ctx.failed, ...errors.map((reason) => ({ ki: '*', reason }))],
            };
        }
        return ctx;
    }
}
