import { MpKind, MpService } from '../mp-event/mp-event.service';

/** Очередь «приход Trade → пересчёт цен»: строки журнала MP_EVENT, которые пишет триггер базы (патч 62). */
export const TRADE_SERVICE: MpService = 'TRADE';
export const INCOMING_KIND: MpKind = 'INCOMING';
export const INCOMING_PENDING = 'pending';
