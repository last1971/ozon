import { InvoiceDto } from '../invoice/dto/invoice.dto';

export interface SubmitFailureDto {
    ki: string;
    reason: string;
}

export interface SubmitResultDto {
    ok: boolean;
    failed?: SubmitFailureDto[];
    skipped?: string;
    skipRetry?: boolean;
    dryRun?: boolean;
    payload?: unknown;
    /** Шаг, на котором оборвались: 'validate' | 'set' | 'status' | 'ship'. */
    failedStep?: string;
    /** true → ошибка на/после set: данные могли уйти, разбираться в ЛК Озона. */
    goToOzon?: boolean;
    /** true → отправление отгружено (ship прошёл или уже было отгружено). */
    shipped?: boolean;
}

/** Строка предпроверки (create-or-get у Озона): нужны ли марка/ГТД маркетплейсу. */
export interface FbsPrepareLineDto {
    productId: number;
    quantity: number;
    /** Маркетплейс требует КМ (Озон is_mandatory_mark_needed). */
    markNeeded: boolean;
    /** Маркетплейс требует ГТД (Озон is_gtd_needed). */
    gtdNeeded: boolean;
}

/** Результат фазы prepare — фронт по нему решает скан-гейт и показывает диалог «точно передать?». */
export interface FbsPrepareDto {
    ok: boolean;
    multiBoxQty?: number;
    lines?: FbsPrepareLineDto[];
    error?: string;
}

export interface IMarkSubmittable {
    submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto>;
    /**
     * Фаза 1: предпроверка перед передачей (Озон create-or-get). Опционально —
     * у маркетплейса без предпроверки (ВБ) метода нет, фаза пропускается на фронте.
     */
    prepareFbsMarks?(invoice: InvoiceDto): Promise<FbsPrepareDto>;
}

export function isMarkSubmittable(service: unknown): service is IMarkSubmittable {
    return typeof (service as IMarkSubmittable)?.submitFbsMarkCodes === 'function';
}
