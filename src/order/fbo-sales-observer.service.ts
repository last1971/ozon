import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { GoodServiceEnum } from '../good/good.service.enum';
import { IFboSales } from '../interfaces/IFboSales';
import { MpService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';

/**
 * Наблюдатель FBO-продаж — аналог `observeFbsWideWindow` (Ozon) и `observeWbFbs` (ВБ)
 * для товара, проданного со склада площадки.
 *
 * Зачем: по FBO-продаже код маркировки уезжает на счёт продажи миграцией (TT=3,
 * STATUS=5), но доставку по FBO никто не читал — вывод из оборота не запускался,
 * коды копились в недельном отчёте висяков (05.10.2026: 30 из 33 кодов, Ozon и ВБ).
 *
 * Одна ответственность: доставленные FBO-отправления площадки → общая цепочка
 * runner'а (журнал `POSTING_FBO/delivered` → продажа → добор). Откуда брать
 * доставленные, знает площадка (`IFboSales`); что делать с продажей — решающая
 * таблица, та же, что у FBS. Холодный старт окном площадки подбирает накопленное.
 *
 * Минута :01 — своя: :00/:05, :02/:07, :03/:08 и :04/:09 заняты кронами, кормящими
 * тот же runner-буфер (общий flush и потолок решений). Боевое время задаёт cron.setup.ts.
 */
@Injectable()
export class FboSalesObserverService {
    private readonly logger = new Logger(FboSalesObserverService.name);
    private readonly sources: { service: MpService; market: GoodServiceEnum; source: IFboSales }[];

    constructor(
        private configService: ConfigService,
        private mpRunner: MpDecisionRunnerService,
        postingFbo: PostingFboService,
        wbOrder: WbOrderService,
    ) {
        this.sources = [
            { service: 'OZON', market: GoodServiceEnum.OZON, source: postingFbo },
            { service: 'WB', market: GoodServiceEnum.WB, source: wbOrder },
        ];
    }

    @Cron('0 1-56/5 * * * *', { name: 'observeFboSales' })
    async observeFboSales(): Promise<void> {
        const markets = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        try {
            for (const { service, market, source } of this.sources) {
                if (!markets.includes(market)) continue;
                let postings: string[];
                try {
                    postings = await source.listDeliveredFbo();
                } catch (e) {
                    this.logger.warn(`${service} FBO: доставленные не прочитаны — ${e.message}`);
                    continue;
                }
                let fresh = 0;
                for (const posting of postings) {
                    const isNew = await this.mpRunner.ingestDelivered({
                        service,
                        kind: 'POSTING_FBO',
                        extId: posting,
                        state: 'delivered',
                        posting,
                    });
                    if (isNew) fresh++;
                }
                if (fresh) this.logger.log(`${service} FBO: доставленных ${postings.length}, новых ${fresh}`);
                await this.mpRunner.drainDelivered(service, 'POSTING_FBO');
            }
        } finally {
            await this.mpRunner.flush('observeFboSales');
        }
    }
}
