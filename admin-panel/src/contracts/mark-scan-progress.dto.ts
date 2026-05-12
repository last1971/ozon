export interface MarkScanProgressLineDto {
    realpricecode: number;
    goodscode: string;
    quantityNeeded: number;
    quantityScanned: number;
    requiresScan: boolean;
    isComplete: boolean;
}

export interface MarkScanProgressDto {
    lines: MarkScanProgressLineDto[];
    isReadyToFinish: boolean;
    attachedKis: string[];
}

export interface MarkScanResultDto {
    attached: { ki: string; goodscode: string; realpricecode: number };
    progress: MarkScanProgressDto;
}

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
}
