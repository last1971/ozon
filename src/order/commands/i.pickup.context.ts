import { FirebirdTransaction } from 'ts-firebird';
import { InvoiceDto } from '../../invoice/dto/invoice.dto';

/** Строка счёта, которой не хватает КМ. */
export interface UncoveredMarkLine {
    realpricecode: number;
    goodscode: string;
    needed: number;
    attached: number;
}

/**
 * Контекст подбора не-FBO счёта по событию доставки: проверка покрытия КМ → подбор.
 * FBO идёт своим путём (`pickupFboUnlessShortage`) — у него другое правило недоборов.
 */
export interface IPickupContext {
    invoice: InvoiceDto;
    transaction: FirebirdTransaction;
    /** Заполняет CheckMarkCoverageCommand; пусто — покрытие в порядке либо проверка не применима. */
    uncovered?: UncoveredMarkLine[];
    stopChain?: boolean;
}
