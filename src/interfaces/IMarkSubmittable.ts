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
}

export interface IMarkSubmittable {
    submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto>;
}

export function isMarkSubmittable(service: unknown): service is IMarkSubmittable {
    return typeof (service as IMarkSubmittable)?.submitFbsMarkCodes === 'function';
}
