import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { LoadLossHistoryCommand } from '../../marketplace-loss/loss.commands';
import { LossContext } from '../../marketplace-loss/loss.contracts';
import { YandexOrderService } from '../yandex.order.service';
import { YandexLossHistorySource } from './yandex-loss-history.source';

/** Строит источник из периода контекста — Яндекс делит 90 дней на 29-дневные окна. */
@Injectable()
export class LoadYandexLossSalesCommand implements IJobCommand<LossContext> {
    readonly phase = 'Продажи и возвраты';
    readonly weight = 70;
    constructor(private readonly orders: YandexOrderService) {}
    async execute<T extends LossContext>(ctx: T): Promise<T> {
        const source = new YandexLossHistorySource(this.orders, ctx.period);
        return new LoadLossHistoryCommand(source).execute(ctx);
    }
}
