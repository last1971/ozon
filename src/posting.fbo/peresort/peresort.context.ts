import { ReturnInvoiceLine } from '../../interfaces/i.return.stock';
import { ISpisContext } from '../../helpers/spis/spis.context';

/** Основание списания «пересортица» (OSN_SPIS.ID) — так оформляют руками в Trade. */
export const PERESORT_OSN_SPIS_ID = 1;

/** Контекст цепочки «пересортица и подбор» — всё в одной транзакции `t`. */
export interface PeresortContext extends ISpisContext {
    posting: string;
    scode: number;
    realpricecode: number;
    username: string;
    /** LoadShortageLine: строка счёта свежим снимком внутри транзакции. */
    line?: ReturnInvoiceLine;
    /** LoadShortageLine: недобор строки = сколько приходуем и подбираем. */
    quantity?: number;
    /** CloseShortage. */
    shortageClosed?: boolean;
    pickedUp?: boolean;
}
