import { Inject, Injectable, Logger } from '@nestjs/common';
import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { LossStatsStore } from '../marketplace-loss/loss-stats.store';
import { LossSnapshot, LossSaveHooks } from '../marketplace-loss/loss.contracts';
import { lossOfferKey } from '../helpers/price/marketplace.loss.stats';

/** Адаптер Ozon: известные фасовки; запись наследуется из единого хранилища MP_LOSS_STATS. */
@Injectable()
export class OzonReturnStore extends LossStatsStore {
    private readonly logger = new Logger(OzonReturnStore.name);
    constructor(@Inject(FIREBIRD) pool: FirebirdPool) {
        super(pool);
    }
    async replace(snapshot: LossSnapshot, hooks?: LossSaveHooks): Promise<void> {
        if (snapshot.service !== 'OZON' || !snapshot.rows.length) throw new Error('Нужен непустой снимок Ozon');
        if (snapshot.rows.some((row) => row.appliedReturnRate == null))
            throw new Error('Не выбран процент для цены Ozon');
        return super.replace(snapshot, hooks);
    }
    async listKnownOffers(): Promise<string[]> {
        const t = await this.pool.getTransaction(ISOLATION_READ_COMMITTED_READ_ONLY);
        try {
            const rows = await t.query(
                `SELECT GOODSCODE, PIECES FROM OZON_PERC
                UNION SELECT GOODSCODE, PIECES FROM MP_LOSS_STATS WHERE SERVICE = 'OZON'`,
                [],
                false,
            );
            const valid = rows.filter(
                (row) =>
                    Number.isSafeInteger(row.GOODSCODE) &&
                    row.GOODSCODE > 0 &&
                    Number.isSafeInteger(row.PIECES) &&
                    row.PIECES > 0,
            );
            const invalid = rows.filter((row) => !valid.includes(row));
            if (invalid.length)
                this.logger.warn(
                    `Пропущены старые некорректные фасовки Ozon: ${invalid.length}; ` +
                        invalid
                            .slice(0, 10)
                            .map((row) => `${row.GOODSCODE}/${row.PIECES}`)
                            .join(', '),
                );
            return valid.map((row) => lossOfferKey(`${row.GOODSCODE}-${row.PIECES}`));
        } finally {
            await t.rollback(true);
        }
    }
}
