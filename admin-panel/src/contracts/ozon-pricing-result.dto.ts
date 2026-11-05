export interface OzonPricingLevelDto {
    price: number;
    profit: number;
    scheme: 'fbs' | 'fbo';
    /** Доля: 0.07 = 7%. */
    commissionRate: number;
}

export interface OzonPricingResultDto {
    offerId: string;
    baseSource: 'market' | 'remaining-lots' | 'all-receipts' | 'none';
    base: number;
    min: OzonPricingLevelDto | null;
    normal: OzonPricingLevelDto | null;
    max: OzonPricingLevelDto | null;
    current: { min: number | null; normal: number | null; max: number | null } | null;
    deadZoneFloor?: number;
    costs: {
        commission: number;
        delivery: number;
        lastMile: number;
        firstMile: number;
        acquiring: number;
        advertising: number;
        packing: number;
        label: number;
        handling: number;
        returns: number;
        tax: number;
        vat: number;
        profitTax: number;
    } | null;
    error?: string;
}
