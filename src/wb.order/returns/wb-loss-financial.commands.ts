import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { ApplyLossExpensesCommand } from '../../marketplace-loss/loss.commands';
import { WbFinancialContext } from '../finance/financial-report.context';
import {
    ValidateWbFinancialReportCommand,
    LoadWbFinancialReportCommand,
    NormalizeWbFinancialReportCommand,
} from '../finance/financial-report.commands';
import { WbLossFinancialContext } from './wb-loss-financial.context';
import { reconcileWbLossExpenses } from './wb-loss-expenses';

@Injectable()
export class PrepareWbLossFinancialCommand implements IJobCommand<WbLossFinancialContext> {
    readonly phase = 'Периоды финансовых отчётов ВБ';
    readonly weight = 1;
    async execute(ctx: WbLossFinancialContext) {
        const start = DateTime.fromISO(ctx.period.from, { zone: 'Europe/Moscow' });
        const end = DateTime.fromISO(ctx.period.to, { zone: 'Europe/Moscow' });
        const tail = end.startOf('week');
        if (!start.isValid || !end.isValid || start >= end) throw new Error('Некорректное окно финансовой сверки');
        const window = (from: DateTime, to: DateTime, reportPeriod: 'weekly' | 'daily'): WbFinancialContext => ({
            from: from.toISO(),
            to: to.minus({ milliseconds: 1 }).toISO(),
            reportPeriod,
            cursor: 0,
            raw: [],
            rows: [],
            progress: ctx.progress,
        });
        ctx.financialWindows = [];
        if (start < tail) ctx.financialWindows.push(window(start, tail, 'weekly'));
        if (tail < end) ctx.financialWindows.push(window(start > tail ? start : tail, end, 'daily'));
        return ctx;
    }
}
/** Повторно использует команды загрузчика 6а в общей job, с общим прогрессом и отменой. */
export class WbLossFinancialPhase implements IJobCommand<WbLossFinancialContext> {
    readonly phase: string;
    readonly weight: number;
    constructor(
        private readonly command: IJobCommand<WbFinancialContext>,
        private readonly index: number,
    ) {
        this.phase = `${index === 0 ? 'Основной' : 'Последний'} отчёт ВБ: ${command.phase}`;
        this.weight = command.weight ?? 1;
    }
    async execute(ctx: WbLossFinancialContext) {
        const child = ctx.financialWindows?.[this.index];
        if (!child) return ctx;
        child.progress = ctx.progress;
        Object.defineProperty(child, 'stopChain', { configurable: true, get: () => ctx.stopChain });
        await this.command.execute(child);
        return ctx;
    }
}
@Injectable()
export class ReconcileWbLossExpensesCommand implements IJobCommand<WbLossFinancialContext> {
    readonly phase = 'Сверка расходов ВБ';
    readonly weight = 30;
    async execute(ctx: WbLossFinancialContext) {
        if (!ctx.financialWindows?.length) throw new Error('Финансовые отчёты ВБ не загружены');
        const result = await reconcileWbLossExpenses(
            ctx,
            ctx.financialWindows.flatMap((w) => w.rows),
        );
        ctx.expenses = result.expenses;
        ctx.financialIssues = result.issues;
        ctx.preliminary = result.issues.length > 0;
        ctx.progress.counters.financialIssues = result.issues.length;
        ctx.financialWindows = [];
        await jobCheckpoint(ctx);
        return ctx;
    }
}
/** Только сборка цепочки. Проценты, загрузка, сверка, запись принадлежат своим командам. */
@Injectable()
export class WbLossFinancialCommands {
    readonly loading: IJobCommand<WbLossFinancialContext>[];
    readonly apply = new ApplyLossExpensesCommand();
    constructor(
        prepare: PrepareWbLossFinancialCommand,
        validate: ValidateWbFinancialReportCommand,
        load: LoadWbFinancialReportCommand,
        normalize: NormalizeWbFinancialReportCommand,
        reconcile: ReconcileWbLossExpensesCommand,
    ) {
        this.loading = [
            prepare,
            ...[0, 1].flatMap((index) =>
                [validate, load, normalize].map((command) => new WbLossFinancialPhase(command, index)),
            ),
            reconcile,
        ];
    }
}
