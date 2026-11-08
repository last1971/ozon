import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ExtraPriceService } from '../../price/extra.price.service';
import { MpEventService } from '../../mp-event/mp-event.service';
import { INCOMING_KIND, INCOMING_PENDING, TRADE_SERVICE } from '../incoming.constants';
import { goodCode } from '../../helpers';
import { IncomingContext } from '../incoming.types';

/** 3. Общая цепочка цен и акций; версия прихода проверяется перед внешними изменениями. */
@Injectable()
export class RepriceIncomingGoodsCommand implements ICommandAsync<IncomingContext> {
    constructor(
        private readonly prices: ExtraPriceService,
        private readonly journal: MpEventService,
    ) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        if (ctx.skus.length === 0) return ctx;
        const result = await this.prices.incomingGoodsChain().execute({
            skus: ctx.skus,
            logger: this.prices.chainLogger(),
            assertInputsCurrent: async (offerId) => {
                const code = goodCode({ offer_id: offerId });
                for (const prihod of ctx.prihods.filter((p) => ctx.goodsByPrihod?.get(p.np)?.includes(code)))
                    if (
                        !(await this.journal.isCurrentVersion(
                            { service: TRADE_SERVICE, kind: INCOMING_KIND, extId: prihod.np, state: INCOMING_PENDING },
                            prihod.version,
                        ))
                    )
                        throw new Error(`Приход ${prihod.np} изменился во время обработки; нужен новый расчёт`);
            },
        });
        const heldSkus = [
            ...new Set(
                (result?.priceReports || [])
                    .flatMap((r) => r.skipped)
                    .filter((s) => s.reason === 'not-in-stock')
                    .map((s) => goodCode({ offer_id: s.offer_id })),
            ),
        ];
        return { ...ctx, heldSkus, failures: result.incomingFailures ?? [] };
    }
}
