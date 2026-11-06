import { Controller, Get } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { pricingReviewMode, PRICING_WRITE_CRONS } from '../helpers/price/pricing-review-mode';

@Controller('price/review-mode')
export class PricingModeController {
    constructor(private readonly scheduler: SchedulerRegistry) {}
    @Get()
    status() {
        return {
            reviewMode: pricingReviewMode(),
            writesAllowed: !pricingReviewMode(),
            crons: [...this.scheduler.getCronJobs()]
                .filter(([name]) => PRICING_WRITE_CRONS.has(name))
                .map(([name, job]) => ({ name, running: Boolean(job.running) })),
        };
    }
}
