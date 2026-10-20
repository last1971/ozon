import { Injectable, Logger } from '@nestjs/common';
import { emptyProgress, IJobCommand } from '../../../interfaces/i.job.context';
import { JobService } from '../../../job/job.service';
import { JobStateDto } from '../../../job/job.state.dto';
import { PromoSweepReport } from '../promo-price.types';
import { ApplySweepCommand } from './apply-sweep.command';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { CollectSweepCommand } from './collect-sweep.command';
import { PlanSweepCommand } from './plan-sweep.command';
import { IPromoSweepContext, PROMO_SWEEP_JOB } from './promo-sweep.context';
import { SweepGoalKind } from './sweep-goal';

/**
 * Сверка акций фоновой задачей: все товары в акциях → отбор по цели → план → (применение) → отчёт.
 * Что отбирать и к чему вести — решает цель (sweep-goal.ts), цепочка одна на все цели.
 * Запуск руками (кнопка в админке); утренний автомат вызовет тот же start(true, 'below-min').
 */
@Injectable()
export class PromoSweepService {
    private readonly logger = new Logger(PromoSweepService.name);
    private readonly commands: IJobCommand<IPromoSweepContext>[];

    constructor(
        private readonly jobs: JobService,
        collect: CollectSweepCommand,
        plan: PlanSweepCommand,
        apply: ApplySweepCommand,
        report: BuildSweepReportCommand,
    ) {
        this.commands = [collect, plan, apply, report];
    }

    /** apply=false — только отчёт; apply=true — выполнить планы. Та же задача уже идёт — вернётся она. */
    start(apply: boolean, goal: SweepGoalKind, clientId?: string): JobStateDto {
        return this.jobs.run<IPromoSweepContext, PromoSweepReport>({
            kind: PROMO_SWEEP_JOB,
            params: { apply, goal },
            clientId,
            commands: this.commands,
            context: { apply, goal, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report as PromoSweepReport,
        });
    }
}
