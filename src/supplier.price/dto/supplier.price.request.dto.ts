import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';

/** Ступень цены поставщика: от `quantity` штук — цена за штуку в валюте поставщика. */
export class SupplierTierInDto {
    @ApiProperty({ example: 100 })
    @IsInt()
    @Min(2)
    quantity: number;

    @ApiProperty({ example: 0.012 })
    @IsNumber()
    @Min(0)
    price: number;
}

/** Одна входящая строка: товар одного поставщика с ценой в его валюте. */
export class SupplierPriceItemDto {
    @ApiProperty({ description: 'Код поставщика (alias в прайсинге)', example: 'compel' })
    @IsString()
    @IsNotEmpty()
    supplier: string;

    @ApiProperty({ description: 'Код товара на сайте', example: 'CMP-1N4007' })
    @IsString()
    @IsNotEmpty()
    code: string;

    @ApiProperty({ description: 'Цена поставщика за штуку в его валюте', example: 0.0186 })
    @IsNumber()
    @Min(0)
    price: number;

    @ApiProperty({ description: 'Валюта поставщика (ISO 4217)', example: 'USD' })
    @IsString()
    @IsNotEmpty()
    currency: string;

    @ApiPropertyOptional({ type: SupplierTierInDto, isArray: true })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SupplierTierInDto)
    tiers?: SupplierTierInDto[];

    @ApiPropertyOptional({ description: 'Кратность: продаётся только пачками по столько штук', example: 10 })
    @IsOptional()
    @IsInt()
    @Min(1)
    multiple?: number;
}

/**
 * Пачка входящих цен поставщиков. Курсы ЦБ передаёт сайт (он читает их из прайсинга) — nest про прайсинг
 * не знает и сам курсы не ходит брать.
 */
export class SupplierPriceRequestDto {
    @ApiProperty({ description: 'Курсы ЦБ: валюта → рублей за единицу', example: { USD: 80.54, CNY: 12.06 } })
    @IsObject()
    rates: Record<string, number>;

    @ApiProperty({ type: SupplierPriceItemDto, isArray: true })
    @IsArray()
    @ArrayMaxSize(1000)
    @ValidateNested({ each: true })
    @Type(() => SupplierPriceItemDto)
    items: SupplierPriceItemDto[];
}
