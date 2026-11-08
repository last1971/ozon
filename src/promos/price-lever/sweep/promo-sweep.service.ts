import { PricingSnapshot } from '../../../helpers/price/price-update.queue';
import { withPricingWarnings, PricingWarning } from '../../../helpers/price/pricing-warnings';
import { assertPricingWritesAllowed } from '../../../helpers/price/pricing-review-mode';
import { EnrichWithPricingCommand } from './enrich-with-pricing.command';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { emptyProgress, IJobCommand } from '../../../interfaces/i.job.context';
import { JobService } from '../../../job/job.service';
import { JobStateDto } from '../../../job/job.state.dto';
import { PromoSweepReport } from '../promo-price.types';
import { ApplySweepCommand } from './apply-sweep.command';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { CollectSweepCommand } from './collect-sweep.command';
import { NotifySweepCommand } from './notify-sweep.command';
import { PlanSweepCommand } from './plan-sweep.command';
import { IPromoSweepContext, PROMO_SWEEP_JOB } from './promo-sweep.context';
import { SweepGoalKind } from './sweep-goal';

/**
 * Сверка акций фоновой задачей: весь каталог → расчёт минимума → отбор по цели → план → (применение) → отчёт.
 * Что отбирать и к чему вести — решает цель (sweep-goal.ts), цепочка одна на все цели.
 * Запуск руками (кнопка в админке) и кроном holdMin — тот же start.
 */
@Injectable()
export class PromoSweepService {
    private readonly logger = new Logger(PromoSweepService.name);
    private readonly commands: IJobCommand<IPromoSweepContext>[];

    constructor(
        private readonly jobs: JobService,
        collect: CollectSweepCommand,
        enrich: EnrichWithPricingCommand,
        plan: PlanSweepCommand,
        apply: ApplySweepCommand,
        report: BuildSweepReportCommand,
        notify: NotifySweepCommand,
    ) {
        this.commands = [collect, enrich, plan, apply, report, notify];
    }

    /**
     * Покупатель видит минимальную (решение владельца 23.10.2026): «Привести к минимальной» с применением.
     * Боевое время задаёт cron.setup.ts; раз в час на 20-й минуте; акция Ozon учитывается за час до старта.
     */
    @Cron('0 20 * * * *', { name: 'ozonPromoSweepMin' })
    holdMin(): void {
        this.start(true, 'min', 'cron');
    }

    /** apply=false — только отчёт; apply=true — выполнить планы. Та же задача уже идёт — вернётся она. */
    start(
        apply: boolean,
        goal: SweepGoalKind,
        clientId?: string,
        offerIds?: string[],
        pricingSnapshots?: Map<string, PricingSnapshot>,
    ): JobStateDto {
        if (apply) assertPricingWritesAllowed();
        const warnings = new Map<string, PricingWarning>();
        return this.jobs.run<IPromoSweepContext, PromoSweepReport>({
            kind: PROMO_SWEEP_JOB,
            params: { apply, goal, ...(offerIds ? { offerIds } : {}) },
            clientId,
            commands: this.commands,
            execute: (run) => withPricingWarnings(warnings, run),
            cleanup: async () => {},
            context: {
                apply,
                goal,
                pricingSnapshots,
                ...(offerIds ? { offerIds } : {}),
                progress: emptyProgress(),
                logger: this.logger,
            },
            result: (ctx) => {
                for (const w of warnings.values())
                    this.logger.warn(`${w.message}: ${w.count}; примеры ${w.examples.join(', ')}`);
                return ctx.report as PromoSweepReport;
            },
        });
    }
}
