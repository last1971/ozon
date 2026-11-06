import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { IJobCommand } from '../../interfaces/i.job.context';
import { LoadLossHistoryCommand } from '../../marketplace-loss/loss.commands';
import { LossContext } from '../../marketplace-loss/loss.contracts';
import { ConfigService } from '@nestjs/config';
import { YandexFirebirdSalesSource } from './yandex-loss-history.source';

/** Загружает продажи из Firebird-инвойсов (STATUS=4, покупатель YANDEX_BUYER_ID). 90 дней, полные данные. */
@Injectable()
export class LoadYandexLossSalesCommand implements IJobCommand<LossContext> {
    readonly phase = 'Продажи и возвраты';
    readonly weight = 70;
    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly config: ConfigService,
    ) {}
    async execute<T extends LossContext>(ctx: T): Promise<T> {
        const buyerId = this.config.get<number>('YANDEX_BUYER_ID', 24465);
        const source = new YandexFirebirdSalesSource(this.pool, buyerId, ctx.period);
        return new LoadLossHistoryCommand(source).execute(ctx);
    }
}
