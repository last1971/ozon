import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { ExtraGoodService } from '../../good/extra.good.service';
import { goodCode } from '../../helpers/product/product.helpers';
import { MarketPriceWorkflowService } from '../../marketplace-loss/prices/market-price-workflow.service';
import { ExtraPriceService } from '../extra.price.service';

/** Приход ждёт подтверждения цены и адресного контроля акций; остальные площадки сохраняют свой путь. */
@Injectable()
export class IncomingPricesCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(
        @Inject(forwardRef(() => ExtraPriceService)) private readonly prices: ExtraPriceService,
        private readonly goods: ExtraGoodService,
        private readonly workflow: MarketPriceWorkflowService,
    ) {}
    async execute(ctx: IGoodsProcessingContext) {
        await this.goods.whenSkuListsReady();
        ctx.incomingFailures = [];
        ctx.priceReports = [];
        const configured = Object.values(GoodServiceEnum).filter((service) => this.prices.getService(service));
        await Promise.all(
            configured.map(async (service) => {
                try {
                    const offers = this.goods
                        .tradeSkusToServiceSkus(ctx.skus, service)
                        .filter((offer) => ctx.skus.includes(goodCode({ offer_id: offer })));
                    if (service === GoodServiceEnum.OZON || service === GoodServiceEnum.WB) {
                        if (!this.goods.isSkuListAvailable(service))
                            throw new Error('Список артикулов площадки недоступен: загрузка завершилась ошибкой');
                        const rows = await this.workflow.incoming(
                            service === GoodServiceEnum.OZON ? 'OZON' : 'WB',
                            offers,
                            ctx.assertInputsCurrent,
                        );
                        for (const row of rows)
                            if (row.error)
                                ctx.incomingFailures.push({ service, offerId: row.offerId, error: row.error });
                    } else {
                        const reports = await this.prices.updatePriceForGoodSkus(ctx.skus, [service]);
                        ctx.priceReports.push(...reports);
                        for (const report of reports) {
                            for (const skip of report.skipped)
                                ctx.incomingFailures.push({
                                    service,
                                    offerId: skip.offer_id,
                                    error: skip.message || skip.reason,
                                });
                            const rows = Array.isArray(report.response)
                                ? report.response.filter((row) => row?.error)
                                : (report.response?.errors ?? []);
                            for (const row of rows) {
                                const offerId = row.offer_id ?? row.offerId;
                                if (!offerId) throw new Error('Площадка сообщила об ошибке отправки цены');
                                ctx.incomingFailures.push({
                                    service,
                                    offerId: String(offerId),
                                    error: String(row.error ?? row.message ?? 'Ошибка отправки цены'),
                                });
                            }
                            if (
                                report.sent.length &&
                                (report.response == null ||
                                    report.response?.error ||
                                    report.response?.status === 'NotOk')
                            )
                                throw new Error('Площадка не подтвердила отправку цены');
                        }
                    }
                } catch (error) {
                    for (const code of ctx.skus)
                        ctx.incomingFailures.push({ service, offerId: code, error: error.message });
                }
            }),
        );
        ctx.logger?.log(`Приход: незавершённых действий ${ctx.incomingFailures.length}`);
        return ctx;
    }
}
