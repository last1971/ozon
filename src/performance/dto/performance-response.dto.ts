import { Transform, Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class PerformanceRowDto {
    id: string;
    title: string;
    date: string;
    views: string;
    clicks: string;

    @IsNumber()
    @Transform(({ obj, key}) => {
        const value = obj[key];
        return parseFloat(value.replace(',', '.'));
    })
    @Type(() => Number)
    moneySpent: number;

    @IsNumber()
    @Transform(({ obj, key}) => {
        const value = obj[key];
        return parseFloat(value.replace(',', '.'));
    })
    @Type(() => Number)
    avgBid: number;

    orders: string;
    ordersMoney: string;
}

export class PerformanceResponseDto {
    @Type(() => PerformanceRowDto)
    rows: PerformanceRowDto[];
} 