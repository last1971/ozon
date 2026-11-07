import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { lossPeriod } from '../../helpers/price/marketplace.loss.stats';
import { LossExclusion } from '../../marketplace-loss/loss.contracts';
import { SaveLossContext, SaveLossSnapshotCommand } from '../../marketplace-loss/loss.commands';
import { LoadYandexLossSalesCommand } from './load-yandex-loss-sales.command';
import { LoadYandexWriteOffsCommand } from './load-yandex-write-offs.command';
import { CalculateYandexLossReportCommand } from './calculate-yandex-loss-report.command';

export interface YandexLossResult {
    service: string;
    preliminary: boolean;
    from: string;
    to: string;
    calculatedAt: Date;
    rows: number;
    excludedGoods: LossExclusion[];
}

/** Сохраняет статистику Яндекс.Маркета общими командами; расчёт цен к ней ещё не подключён. */
@Injectable()
export class YandexLossService {
    constructor(
        private readonly jobs: JobService,
        private readonly config: ConfigService,
        private readonly sales: LoadYandexLossSalesCommand,
        private readonly writeOffs: LoadYandexWriteOffsCommand,
        private readonly calculate: CalculateYandexLossReportCommand,
        private readonly save: SaveLossSnapshotCommand,
    ) {}

    start(clientId?: string, now = new Date()) {
        const services = this.config.get<string[] | string>('SERVICES', []);
        if (!(Array.isArray(services) ? services : services.split(',')).includes(GoodServiceEnum.YANDEX))
            throw new Error('Яндекс не подключён к этому кабинету');
        const period = lossPeriod(now);
        const context: SaveLossContext = {
            service: 'YANDEX',
            preliminary: false,
            period,
            calculatedAt: new Date(now.getTime()),
            sales: [],
            writeOffs: [],
            rows: [],
            progress: emptyProgress(),
        };
        return this.jobs.run<SaveLossContext, YandexLossResult>({
            kind: 'loss-recalculate:yandex',
            params: { ...period },
            clientId,
            context,
            commands: [this.sales, this.writeOffs, this.calculate, this.save],
            canCancel: (c) => !c.committing,
            cleanup: async () => {},
            result: (c) => ({
                service: c.service,
                preliminary: c.preliminary,
                ...c.period,
                calculatedAt: c.calculatedAt,
                rows: c.rows.length,
                excludedGoods: c.excludedGoods ?? [],
            }),
        });
    }
}
