import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsString } from 'class-validator';
import { WbCategoryMode } from '../interfaces/wb-create-card.interface';

export class CreateWbCardDto {
    @ApiProperty({ description: 'Артикул товара в Ozon (offer_id)' })
    @IsNotEmpty()
    @IsString()
    offerId: string;

    @ApiProperty({ description: 'Способ выбора WB категории', enum: WbCategoryMode })
    @IsNotEmpty()
    @IsEnum(WbCategoryMode)
    categoryMode: WbCategoryMode;

    @ApiPropertyOptional({ description: 'WB subjectId (если categoryMode = manual)' })
    @IsOptional()
    @IsNumber()
    subjectId?: number;

    @ApiPropertyOptional({ description: 'Включить веб-поиск для AI характеристик' })
    @IsOptional()
    @IsBoolean()
    webSearch?: boolean;

    @ApiPropertyOptional({ description: 'Отправить в WB (false = dry-run)', default: false })
    @IsOptional()
    @IsBoolean()
    submit?: boolean;
}
