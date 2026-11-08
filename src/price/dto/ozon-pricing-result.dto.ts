import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';
import type { PriceBaseSource } from '../../good/dto/good.price.dto';
import type { OzonPriceEvaluation } from '../../helpers/price/ozon.pricing';

export interface OzonPricingLevelDto {
    price: number;
    profit: number;
    scheme: 'fbs' | 'fbo';
    /** Доля, например 0.07 = 7%. */
    commissionRate: number;
    profitPercent?: number;
    requestedMarkup?: number;
    appliedMarkup?: number;
    targetProfit?: number;
}

export class OzonPricingResultDto {
    offerId: string;
    baseSource: PriceBaseSource = 'none';
    base = 0;
    min: OzonPricingLevelDto | null = null;
    normal: OzonPricingLevelDto | null = null;
    max: OzonPricingLevelDto | null = null;
    /** Отдельный снимок API, не заменяется расчётными ценами. */
    current: { min: number | null; normal: number | null; max: number | null } | null = null;
    limits?: { minProfitRub: number; minMarkupPercent: number };
    buyer?: { price: number; profit: number; profitPercent: number };
    lowerBand?: { ceiling: number; profit: number | null; targetProfit: number; eligible: boolean };
    costSources?: Record<string, string>;
    warnings?: string[];
    deadZoneFloor?: number;
    costs: Omit<OzonPriceEvaluation['costs'], 'base'> | null = null;
    error?: string;
}

/** Только редактируемые входы предварительного расчёта. Ничего не сохраняет. */
export class OzonPricingPreviewDto {
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) min_perc?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) perc?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) old_perc?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) adv_perc?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) sum_pack?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) available_price?: number;
}
