import { FirebirdTransaction } from 'ts-firebird';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { PostingDto } from '../../posting/dto/posting.dto';
import { InvoiceDto } from '../../invoice/dto/invoice.dto';
import { FboShortageDto } from '../dto/fbo-shortage.dto';

/** Контекст создания FBO-счёта (общий для Ozon legacy/migration и WB). Прогоняется через CommandChainAsync. */
export interface IFboCreateContext {
    service: GoodServiceEnum;
    posting: PostingDto;
    /** Уровни склада для подбора: Ozon [warehouse, cluster, suffix]; WB ['WBFBO']. */
    prims: string[];
    /** Куда писать в журнал недостачи (человекочитаемый склад/кластер). */
    primLabel: string;
    buyerId: number;
    /** MARK_CODES_ENABLED: true — миграция кодов, false — legacy подборка без кодов. */
    useMigration: boolean;
    /** Ozon: пометить IGK=NOT1C после создания. */
    setIgkNot1c: boolean;
    /** WB: подобрать счёт (pickup) сразу после создания. */
    pickupAfterCreate: boolean;
    /** WB: заказ без подбора вообще — «левый», тихо пропускаем (не недостача, не письмо). Ozon: false. */
    skipIfNoPodbor: boolean;
    transaction: FirebirdTransaction;
    /** Отложенные действия после commit (письмо о недоборе шлём тут, чтобы не слать при откате). */
    flushers?: (() => Promise<void>)[];
    shortages?: FboShortageDto[];
    invoice?: InvoiceDto | null;
    stopChain?: boolean;
}
