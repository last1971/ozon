import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { evaluateLine, worstLevel } from '../profit-check.calculator';
import { profitLineKey } from '../profit-check.retry';
import { LineVerdict, ProfitCheckContext } from '../profit-check.types';

/** 4. Независимый вердикт по строкам; временные сбои сохраняются для повтора. */
@Injectable()
export class EvaluateCommand implements ICommandAsync<ProfitCheckContext> {
    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const items = ctx.items.map((item) => {
            if (item.deferred)
                return item.retryReason ? { ...item, level: 'skip' as const, reason: item.retryReason } : item;
            if (!item.resolved) return { ...item, level: 'skip' as const };
            const pc = ctx.priceContexts?.get(item.payload.service);
            if (pc === null) return { ...item, level: 'skip' as const, reason: 'площадка выключена на этом узле' };
            const completed = new Set(item.payload.check?.completedLineKeys ?? []);
            const verdicts: LineVerdict[] = item.payload.lines
                .filter((l) => !completed.has(profitLineKey(l)))
                .map((l) => {
                    const issue =
                        pc?.issues?.get(l.offer_id) ??
                        (!pc || !pc.coeffs
                            ? { kind: 'temporary' as const, reason: 'данные расчёта ещё не загружены' }
                            : undefined);
                    if (issue)
                        return {
                            ...l,
                            level: 'skip',
                            minPrice: null,
                            profitPerUnit: null,
                            profitTotal: null,
                            cost: null,
                            costSource: null,
                            reason: issue.reason,
                            failureKind: issue.kind,
                            retryable: issue.kind === 'temporary',
                        };
                    return evaluateLine(l, pc.priceables.get(l.offer_id), pc.coeffs, ctx.warnPercent);
                });
            for (const verdict of verdicts) if (!verdict.retryable) completed.add(profitLineKey(verdict));
            const retryReason =
                [...new Set(verdicts.filter((v) => v.retryable).map((v) => `${v.offer_id}: ${v.reason}`))].join('; ') ||
                undefined;
            return {
                ...item,
                verdicts,
                completedLineKeys: [...completed],
                deferred: !!retryReason,
                retryReason,
                reason: retryReason,
                level: worstLevel(verdicts.map((v) => v.level)),
            };
        });
        return { ...ctx, items };
    }
}
