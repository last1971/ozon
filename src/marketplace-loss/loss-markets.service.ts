import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobStateDto } from '../job/job.state.dto';

export interface LossRecalculator {
    start(clientId?: string): JobStateDto;
}
export const LOSS_RECALCULATORS = Symbol('LOSS_RECALCULATORS');
const labels = { OZON: 'Ozon', WB: 'ВБ', YANDEX: 'Яндекс' };

/** Реестр готовых цепочек. Новая площадка подключается адаптером, без копий расчёта. */
@Injectable()
export class LossMarketsService {
    constructor(
        private readonly config: ConfigService,
        @Inject(LOSS_RECALCULATORS) private readonly runners: Record<string, LossRecalculator>,
    ) {}
    list() {
        const configured = this.config.get<string[] | string>('SERVICES', []);
        const enabled = (Array.isArray(configured) ? configured : configured.split(',')).map((s) =>
            s.trim().toUpperCase(),
        );
        return Object.keys(this.runners)
            .filter((service) => enabled.includes(service))
            .map((service) => ({ service, label: labels[service] ?? service }));
    }
    require(service: string): string {
        const key = service.toUpperCase();
        if (!this.list().some((m) => m.service === key))
            throw new BadRequestException('Статистика этой площадки не подключена к кабинету');
        return key;
    }
    start(service: string, clientId?: string) {
        return this.runners[this.require(service)].start(clientId);
    }
}
