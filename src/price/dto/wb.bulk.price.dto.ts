import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { toStringList } from '../../helpers';

/** Вход ручки min-price: список артикулов ИЛИ файл. */
export class WbBulkPriceDto {
    @ApiProperty({
        description: 'Артикулы продавца. Используется, если файл не передан.',
        type: [String],
        required: false,
    })
    @IsOptional()
    @Transform(toStringList)
    articles?: string[];
}

/** Вход ручек discount / discount-safe: список артикулов (или файл) + обязательная скидка. */
export class WbBulkDiscountDto extends WbBulkPriceDto {
    @ApiProperty({
        description: 'Скидка, %. Целое 0..99.',
        example: 40,
    })
    @IsNotEmpty()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(99)
    percent: number;
}
