import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { GoodServiceEnum } from '../good/good.service.enum';
import { WbPriceService } from './wb.price.service';

/** Отчёт сторожа, когда он что-то поменял (NotifierService → тема «цены»). */
export const WB_MIN_PRICES_EVENT = 'wb.min.prices';

/**
 * Сторож минимальной цены ВБ (решение владельца 23.10.2026: покупатель видит минимальную).
 * Зовёт ту же ручку, что и руками (`wb/min-price` без артикулов), по всем карточкам кабинета:
 * акция ВБ, задравшая скидку, откатывается, цена выше минимальной опускается.
 * Сообщает, только если поменял: «нет минимальной в базе» повторялось бы каждый прогон.
 */
@Injectable()
export class WbMinPriceGuard {
    private readonly logger = new Logger(WbMinPriceGuard.name);
    private running = false;

    constructor(
        private readonly wbPrice: WbPriceService,
        private readonly config: ConfigService,
        private readonly events: EventEmitter2,
    ) {}

    // Боевое время задаёт cron.setup.ts; :09/:24/… — мимо пятиминуток заказов и проверки прибыли.
    @Cron('0 9/15 * * * *', { name: 'wbHoldMinPrices' })
    async run(): Promise<void> {
        if (this.running || !this.config.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.WB)) return;
        this.running = true;
        try {
            const report = await this.wbPrice.setMinPrices([]);
            if (!report.toUpdate) return;
            this.logger.log(
                `ВБ к минимальной: изменено ${report.toUpdate}, база ниже минимальной ${report.belowMin.length}, ` +
                    `задача ${report.uploadId ?? '—'}`,
            );
            this.events.emit(WB_MIN_PRICES_EVENT, report);
        } catch (e) {
            this.logger.error(`ВБ к минимальной не выполнено — ${(e as Error).message}`);
        } finally {
            this.running = false;
        }
    }
}
