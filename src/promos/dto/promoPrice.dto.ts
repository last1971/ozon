import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';

export class PromoPriceStateRequestDto {
    @ApiProperty({ description: 'Наши артикулы (offer_id), до 100', type: [String] })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(100)
    @IsString({ each: true })
    offer_ids: string[];
}

export class PromoPricePlanRequestDto extends PromoPriceStateRequestDto {
    @ApiProperty({
        description: "Цель: 'min' (min_price), 'normal' (price) или цена в рублях; зажимается в [min_price, price]",
        example: 'min',
    })
    @IsNotEmpty()
    target: string | number;

    @ApiProperty({
        description: 'Процент нашей акции (не ниже её минимума). Без него — минимум акции или подбор под цель',
        required: false,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(90)
    percent?: number;
}
