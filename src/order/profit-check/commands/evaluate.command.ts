import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { evaluateLine, worstLevel } from '../profit-check.calculator';
import { ProfitCheckContext } from '../profit-check.types';

/** 4. Вердикт по каждой строке и заказу. Чистый расчёт по собранным данным. */
@Injectable()
export class EvaluateCommand implements ICommandAsync<ProfitCheckContext> {
    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const items = ctx.items.map((item) => {
            if (item.deferred) return item;
            if (!item.resolved) return { ...item, level: 'skip' as const };
            const pc = ctx.priceContexts?.get(item.payload.service);
            if (!pc) return { ...item, level: 'skip' as const, reason: 'площадка выключена на этом узле' };
            const verdicts = item.payload.lines.map((l) =>
                evaluateLine(l, pc.priceables.get(l.offer_id), pc.coeffs, ctx.warnPercent),
            );
            return { ...item, verdicts, level: worstLevel(verdicts.map((v) => v.level)) };
        });
        return { ...ctx, items };
    }
}
