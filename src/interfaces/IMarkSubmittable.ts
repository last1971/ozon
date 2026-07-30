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

export interface IMarkSubmittable {
    submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto>;
}

export function isMarkSubmittable(service: unknown): service is IMarkSubmittable {
    return typeof (service as IMarkSubmittable)?.submitFbsMarkCodes === 'function';
}
