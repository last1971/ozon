import { Injectable, Logger } from '@nestjs/common';
import { RateLimit, setRateLimitBlocked } from '../helpers/decorators/rate-limit.decorator';

/**
 * Одна калитка ко всем «справочным» вызовам контентного API ВБ (характеристики и справочники предметов,
 * отложенные ошибки карточек): не чаще раза в секунду, при 429 — пауза retryAfterMs и повтор (до трёх раз).
 * Лимит у ВБ общий на все контентные методы, и после выкачки каталога он исчерпан — без паузы ответы идут 429.
 * api.method не бросает — 429 приходит как {error:{status:429, retryAfterMs}}.
 */
@Injectable()
export class WbContentGate {
    private readonly logger = new Logger(WbContentGate.name);

    @RateLimit(1000)
    async call(label: string, fn: () => Promise<any>, attempt = 0): Promise<any> {
        const res = await fn();
        if (res?.error?.status === 429 && attempt < 3) {
            const retryAfterMs = res.error.retryAfterMs || 60000;
            this.logger.warn(`ВБ 429 на ${label}, ждём ${retryAfterMs} мс и повторяем`);
            setRateLimitBlocked(WbContentGate.name, 'call', Date.now() + retryAfterMs);
            return this.call(label, fn, attempt + 1);
        }
        return res;
    }
}
