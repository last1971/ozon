import { FirebirdTransaction } from 'ts-firebird';
import { ReturnInvoiceLine } from '../../interfaces/i.return.stock';

/** Основание списания «пересортица» (OSN_SPIS.ID) — так оформляют руками в Trade. */
export const PERESORT_OSN_SPIS_ID = 1;

/** Контекст цепочки «пересортица и подбор» — всё в одной транзакции `t`. */
export interface PeresortContext {
    t: FirebirdTransaction;
    posting: string;
    scode: number;
    realpricecode: number;
    username: string;
    /** LoadShortageLine: строка счёта свежим снимком внутри транзакции. */
    line?: ReturnInvoiceLine;
    /** LoadShortageLine: недобор строки = сколько приходуем и подбираем. */
    quantity?: number;
    /** CreatePeresortDoc: номер документа списания. */
    spisCode?: number;
    /** CloseShortage. */
    shortageClosed?: boolean;
    pickedUp?: boolean;
}
