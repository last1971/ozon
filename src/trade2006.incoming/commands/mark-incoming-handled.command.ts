import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { MpEventService } from '../../mp-event/mp-event.service';
import { goodCode } from '../../helpers/product/product.helpers';
import { IncomingContext } from '../incoming.types';
import { INCOMING_KIND, INCOMING_PENDING, TRADE_SERVICE } from '../incoming.constants';

/** Закрываем только подтверждённую версию; остаток работы хранится в существующем MP_EVENT. */
@Injectable()
export class MarkIncomingHandledCommand implements ICommandAsync<IncomingContext> {
    private readonly logger = new Logger(MarkIncomingHandledCommand.name);
    constructor(private readonly journal: MpEventService) {}
    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        ctx.completed = [];
        ctx.pending = [];
        for (const prihod of ctx.prihods) {
            const codes = new Set(ctx.goodsByPrihod?.get(prihod.np) ?? []);
            const reasons = [
                ...new Set([
                    ...(ctx.failures ?? [])
                        .filter((f) => codes.has(goodCode({ offer_id: f.offerId })))
                        .map((f) => `${f.service} ${f.offerId}: ${f.error}`),
                    ...(ctx.heldSkus ?? [])
                        .filter((code) => codes.has(code))
                        .map((code) => `${code}: нет остатка на складе`),
                ]),
            ];
            const payload = {
                ...incomingPayload(prihod.payload),
                incoming: {
                    version: 1,
                    checkedAt: new Date().toISOString(),
                    pending: reasons,
                },
            };
            const saved = await this.journal.finishVersion(
                { service: TRADE_SERVICE, kind: INCOMING_KIND, extId: prihod.np, state: INCOMING_PENDING },
                prihod.version,
                payload,
                reasons.length === 0,
            );
            if (!saved) reasons.push('Приход изменился во время обработки; требуется новый проход');
            if (reasons.length) {
                ctx.pending.push({ np: prihod.np, reasons });
                this.logger.warn(`Приход ${prihod.np} оставлен в очереди: ${reasons.join('; ')}`);
            } else ctx.completed.push(prihod.np);
        }
        return ctx;
    }
}
function incomingPayload(payload: unknown): Record<string, unknown> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
}
