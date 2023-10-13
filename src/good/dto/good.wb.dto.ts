import { IsNumber, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoodWbDto {
    @ApiProperty({
        description: 'SKU',
        required: true,
    })
    @IsString()
    id: string;
    @ApiProperty({
        description: 'Процент комиссии',
        required: true,
    })
    @IsNumberString()
    commission: number;
    @ApiProperty({
        description: 'Стоимость доставки',
        required: true,
    })
    @IsNumberString()
    tariff: number;
    @ApiProperty({
        description: 'Минимальная цена',
        required: false,
    })
    @IsNumber()
    @IsOptional()
    minPrice?: number;
}
