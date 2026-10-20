import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { describeOzonResult, ozonResultsByOffer, ServicePriceReport } from '../price-update.report';
import { GoodServiceEnum } from '../../good/good.service.enum';

const SKIP_TEXT = {
    'no-free-stock': 'нет свободного остатка (всё в резерве или распродано)',
    'not-in-stock': 'товара нет на складе',
};

/**
 * Журнал пересчёта цен по товару: из чего считали (входная, рыночная, наценки, коэффициенты площадки),
 * что отправили и что ответила площадка. Отказ Озона (`updated:false`, errors) — предупреждением.
 * Пропущенные артикулы — с причиной. Только пишет, контекст не меняет.
 */
@Injectable()
export class LogPriceReportsCommand implements ICommandAsync<IGoodsProcessingContext> {
    private readonly logger = new Logger('PriceJournal');

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        for (const report of context.priceReports || []) this.logReport(report);
        return context;
    }

    private logReport(report: ServicePriceReport): void {
        const tag = `[цены ${report.service}]`;
        const c = report.coeffs;
        if (c) {
            this.logger.log(
                `${tag} коэффициенты: мин.логистика ${c.minMil}, логистика ${c.percMil}%, эквайринг ${c.percEkv}%, ` +
                    `доставка ${c.sumObtain}, этикетка ${c.sumLabel}, налог ${c.taxUnit}%` +
                    (c.sumPack !== undefined ? `, упаковка ${c.sumPack}` : ''),
            );
        }
        const inputs = new Map(report.inputs.map((i) => [i.offer_id, i]));
        const ozon = report.service === GoodServiceEnum.OZON ? ozonResultsByOffer(report.response) : null;
        for (const sent of report.sent) {
            const i = inputs.get(sent.offer_id);
            const took = i
                ? `вх ${round(i.incoming_price)}` +
                  (i.available_price > 0 ? ` (рыночная ${round(i.available_price)})` : '') +
                  `, наценки мин/норм/макс ${i.min_perc}/${i.perc}/${i.old_perc}, реклама ${i.adv_perc}, ` +
                  `упаковка ${i.sum_pack}, комиссия ${i.sales_percent}%, логистика до ${i.fbs_direct_flow_trans_max_amount}`
                : 'данных расчёта нет';
            const line = `${tag} ${sent.offer_id}: ${took} → отправили ${sent.price}/${sent.old_price}/${sent.min_price} (цена/до скидки/мин)`;
            if (!ozon) {
                this.logger.log(line);
                continue;
            }
            const result = ozon.get(sent.offer_id);
            const answer = `→ Озон: ${describeOzonResult(result)}`;
            if (result?.updated) this.logger.log(`${line} ${answer}`);
            else this.logger.warn(`${line} ${answer}`);
        }
        if (!ozon && report.response) {
            this.logger.log(`${tag} ответ площадки: ${truncate(JSON.stringify(report.response), 500)}`);
        }
        for (const skip of report.skipped) {
            this.logger.log(`${tag} ${skip.offer_id}: цену не считали — ${SKIP_TEXT[skip.reason]}`);
        }
    }
}

function round(n: number): number {
    return Math.round(Number(n) * 100) / 100;
}

function truncate(s: string, max: number): string {
    return s && s.length > max ? `${s.slice(0, max)}…` : s;
}
