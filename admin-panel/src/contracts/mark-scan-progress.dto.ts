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
    // Шаг обрыва цепочки Озона: 'validate' | 'set' | 'status' | 'ship'.
    failedStep?: string;
    // true → ошибка на/после set: данные могли уйти, разбираться в ЛК Озона.
    goToOzon?: boolean;
    // true → отправление отгружено.
    shipped?: boolean;
}

// Результат фазы prepare (create-or-get) — Озон.
export interface FbsPrepareDto {
    ok: boolean;
    multiBoxQty?: number;
    lines?: { productId: number; quantity: number; markNeeded: boolean; gtdNeeded: boolean }[];
    error?: string;
}
