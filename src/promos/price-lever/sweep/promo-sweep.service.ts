import { Injectable, Logger } from '@nestjs/common';
import { emptyProgress, IJobCommand } from '../../../interfaces/i.job.context';
import { JobService } from '../../../job/job.service';
import { JobStateDto } from '../../../job/job.state.dto';
import { PromoSweepReport } from '../promo-price.types';
import { ApplyBelowMinCommand } from './apply-below-min.command';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { CollectBelowMinCommand } from './collect-below-min.command';
import { PlanBelowMinCommand } from './plan-below-min.command';
import { IPromoSweepContext, PROMO_SWEEP_JOB } from './promo-sweep.context';

/**
 * Сверка «ниже минимума» фоновой задачей: все товары в акциях → ниже min_price → план → (применение) → отчёт.
 * Запуск руками (кнопка в админке); утренний автомат вызовет тот же start(true).
 */
@Injectable()
export class PromoSweepService {
    private readonly logger = new Logger(PromoSweepService.name);
    private readonly commands: IJobCommand<IPromoSweepContext>[];

    constructor(
        private readonly jobs: JobService,
        collect: CollectBelowMinCommand,
        plan: PlanBelowMinCommand,
        apply: ApplyBelowMinCommand,
        report: BuildSweepReportCommand,
    ) {
        this.commands = [collect, plan, apply, report];
    }

    /** apply=false — только отчёт; apply=true — выполнить планы. Та же задача уже идёт — вернётся она. */
    start(apply: boolean, clientId?: string): JobStateDto {
        return this.jobs.run<IPromoSweepContext, PromoSweepReport>({
            kind: PROMO_SWEEP_JOB,
            params: { apply },
            clientId,
            commands: this.commands,
            context: { apply, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report as PromoSweepReport,
        });
    }
}
