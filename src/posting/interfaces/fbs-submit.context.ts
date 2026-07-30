import { InvoiceDto } from '../../invoice/dto/invoice.dto';
import { SubmitFailureDto, SubmitResultDto } from '../../interfaces/IMarkSubmittable';
import { ExemplarCreateOrGetResponseDto } from '../dto/exemplar.create-or-get.dto';
import { ExemplarSetProductDto } from '../dto/exemplar.set.dto';

/**
 * Контекст цепочки передачи данных FBS в Озон (паттерн «команда», CommandChainAsync).
 * Команды: CreateOrGet → BuildPayload → SetAndConfirm (в 2b добавятся Validate/Ship).
 * stopChain=true — оборвать цепочку; result — итог для ответа наружу.
 */
export interface IFbsSubmitContext {
    invoice: InvoiceDto;
    postingNumber: string;

    /** Привязанные КМ строки счёта (маркированные позиции). */
    attached: { ki: string; goodscode: string; realpricecode: number; quantity: number }[];
    /** KI → полный КМ (KM_FULL) для передачи в Озон. */
    kmFullByKi: Map<string, string>;
    /** KI → ГТД (обрезанная) по приходу кода; null → is_gtd_absent. */
    gtdByKi: Map<string, string | null>;

    /** Ответ create-or-get: продукты, экземпляры, флаги is_mandatory_mark_needed / is_gtd_needed. */
    exResp?: ExemplarCreateOrGetResponseDto;
    /** Построенный payload set (по product_id). */
    setProducts?: ExemplarSetProductDto[];
    multiBoxQty?: number;

    /** Накопленные провалы по строкам. */
    failed: SubmitFailureDto[];
    /** Итог цепочки. */
    result?: SubmitResultDto;
    /** true → CommandChainAsync прерывает цепочку. */
    stopChain?: boolean;
}
