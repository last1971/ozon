import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';

/**
 * Шаг после status=ship_available: отгрузка (/v4/posting/fbs/ship).
 * exemplar_ids берём из построенного payload. Успех → result.shipped=true.
 */
@Injectable()
export class ShipExemplarsCommand implements ICommandAsync<IFbsSubmitContext> {
    private readonly logger = new Logger(ShipExemplarsCommand.name);

    constructor(@Inject(forwardRef(() => PostingService)) private readonly postingService: PostingService) {}

    async execute(ctx: IFbsSubmitContext): Promise<IFbsSubmitContext> {
        const products = (ctx.setProducts ?? []).map((p) => ({
            product_id: p.product_id,
            quantity: p.exemplars.length,
            exemplar_ids: p.exemplars.map((e) => e.exemplar_id),
        }));
        const req = { posting_number: ctx.postingNumber, packages: [{ products }] };
        this.logger.log(`[km ${ctx.postingNumber}] ship req=${JSON.stringify(req)}`);
        try {
            const resp = await this.postingService.shipPosting(req);
            this.logger.log(`[km ${ctx.postingNumber}] ship resp=${JSON.stringify(resp)}`);
            const shipped = Array.isArray(resp?.result) && resp.result.length > 0;
            if (shipped) {
                ctx.result = { ok: true, shipped: true };
            } else {
                const reason = (resp as any)?.error?.message ?? 'ship вернул пустой result';
                ctx.stopChain = true;
                ctx.result = {
                    ok: false,
                    failedStep: 'ship',
                    goToOzon: true,
                    failed: [...ctx.failed, { ki: '*', reason: `ship: ${reason}` }],
                };
            }
        } catch (e) {
            // ДОПУЩЕНИЕ: точная реакция Озона на повторный ship уже-отгруженного не проверялась
            // (кейс вне флоу). Пока любую ошибку ship считаем провалом с goToOzon — оператор проверит в ЛК.
            const msg = e?.message ?? String(e);
            this.logger.warn(`[km ${ctx.postingNumber}] ship error: ${msg}`);
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failedStep: 'ship',
                goToOzon: true,
                failed: [...ctx.failed, { ki: '*', reason: `ship: ${msg}` }],
            };
        }
        return ctx;
    }
}
