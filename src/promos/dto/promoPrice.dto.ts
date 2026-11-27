import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class PromoPriceStateRequestDto {
    @ApiProperty({ description: 'Наши артикулы (offer_id), до 100', type: [String] })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(100)
    @IsString({ each: true })
    offer_ids: string[];
}
