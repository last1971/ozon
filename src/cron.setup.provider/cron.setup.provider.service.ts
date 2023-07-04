import { Injectable } from '@nestjs/common';
import { SchedulerRegistry, Timeout } from '@nestjs/schedule';
import { cronConfig } from './cron.setup';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../env.validation';
import { CronTime } from 'cron';

@Injectable()
export class CronSetupProviderService {
    constructor(private schedulerRegistry: SchedulerRegistry, private configService: ConfigService) {}
    @Timeout(0)
    setupConJobs() {
        const environment = this.configService.get<Environment>('NODE_ENV');
        this.schedulerRegistry.getCronJobs().forEach((job, key) => {
            const jobSettings = cronConfig[key]?.[environment];
            if (!jobSettings) {
                job.stop();
            } else {
                if (typeof jobSettings === 'boolean') {
                    if (jobSettings) job.start();
                    else job.stop();
                } else {
                    const { enabled, settings } = jobSettings;
                    job.setTime(new CronTime(settings.time));
                    if (enabled) job.start();
                    else job.stop();
                }
            }
        });
    }
}
