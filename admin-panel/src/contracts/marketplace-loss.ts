export interface LossExpenses {
    paidReturnDelivery?: number | null;
    cancellationDelivery: number | null;
    sellerReturnDelivery: number | null;
    confirmedDefectCompensation: number;
}
export interface LossRow {
    offerId: string;
    soldUnits: number | null;
    returnedUnits: number | null;
    writtenOffUnits: number | null;
    returnRate: number | null;
    appliedReturnRate?: number | null;
    defectRate: number | null;
    state: 'MIGRATED' | 'NO_SALES' | 'READY' | 'REVIEW' | 'PARTIAL';
    calculatedAt: string;
    warnings: string[];
    expenses?: LossExpenses;
}
export interface LossSnapshot {
    service: string;
    preliminary: boolean;
    period: { from: string; to: string } | null;
    calculatedAt: string;
    rows: LossRow[];
}
export interface LossCostReport {
    offerId: string;
    calculatedAt?: string;
    costs: {
        returns: number;
        cancellations: number;
        sellerReturns: number;
        defects: number;
        defectCompensation: number;
    } | null;
    price?: number;
    scheme?: string;
    error?: string;
}
