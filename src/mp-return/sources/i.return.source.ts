import { MpService } from '../../mp-event/mp-event.service';
import { ReturnScan } from '../../helpers/return-scan.parser';
import { ReturnLineDto } from '../dto/return-line.dto';

/**
 * Откуда экран приёма берёт возвраты маркетплейса. Одна реализация на маркетплейс;
 * всё, что дальше (карточка, команды приёма и списания), от маркетплейса не зависит.
 */
export interface IReturnSource {
    readonly service: MpService;
    /** Возвраты, которые маркетплейс отметил полученными нами, в окне [from, to). */
    listReceived(from: Date, to: Date): Promise<ReturnLineDto[]>;
    /** Строки возврата по скану/вводу кладовщика. Пусто — не нашли. */
    find(scan: ReturnScan): Promise<ReturnLineDto[]>;
}

export const RETURN_SOURCES = 'RETURN_SOURCES';
