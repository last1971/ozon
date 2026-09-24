import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IMissingTnvedContext } from '../../interfaces/i.missing.tnved.context';

/**
 * Разность: карточки маркетплейса минус товары с ТН ВЭД. Остаток делится на два списка —
 * «ТН ВЭД пуст» (товар в базе есть) и «нет в базе» (кода нет вообще). Считает счётчики задачи.
 */
@Injectable()
export class DiffMissingTnvedCommand implements IJobCommand<IMissingTnvedContext> {
    async execute(context: IMissingTnvedContext): Promise<IMissingTnvedContext> {
        const offers = context.offers ?? [];
        const allGoods = context.allGoods ?? new Set<string>();
        const withTnved = context.withTnved ?? new Set<string>();
        const report = { market: context.market, offers: offers.length, noTnved: [], notInBase: [] };

        for (const o of offers) {
            if (withTnved.has(o.goodscode)) continue;
            if (allGoods.has(o.goodscode)) report.noTnved.push(o);
            else report.notInBase.push(o);
        }
        context.report = report;
        Object.assign(context.progress.counters, {
            offers: offers.length,
            noTnved: report.noTnved.length,
            notInBase: report.notInBase.length,
        });
        return context;
    }
}
