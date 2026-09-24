import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';

/** Решения маркетплейса → отчёт: уже ок / на правку / спорно (руками) / нет карточки. */
@Injectable()
export class BuildTnvedReportCommand implements IJobCommand<ITnvedProcessingContext> {
    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const items = context.items ?? [];
        context.report = {
            apply: !!context.opts.apply,
            checkedGoods: (context.base ?? []).length,
            checkedOffers: items.length,
            toFix: [],
            alreadyOk: 0,
            notFoundOnOzon: context.notFound ?? [],
            ambiguous: [],
            skippedProcessed: context.skippedProcessed ?? 0,
            remaining: 0,
        };
        for (const item of items) {
            if (item.ambiguousReason) context.report.ambiguous.push({ offer: item.offer, reason: item.ambiguousReason });
            else if (item.ok) context.report.alreadyOk++;
            else context.report.toFix.push({ ...item });
        }
        // счётчики задачи — чтобы их было видно по ходу, до конца цепочки
        Object.assign(context.progress.counters, {
            ok: context.report.alreadyOk,
            toFix: context.report.toFix.length,
            ambiguous: context.report.ambiguous.length,
            notFound: context.report.notFoundOnOzon.length,
        });
        return context;
    }
}
