import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { GoodServiceEnum } from '../good.service.enum';
import { toStringList } from '../../helpers';

/** Вход ручки disable: сервис + список SKU ИЛИ файл. */
export class DisableGoodsDto {
    @IsEnum(GoodServiceEnum)
    @ApiProperty({
        description: 'service name',
        enum: GoodServiceEnum,
    })
    service: GoodServiceEnum;

    @ApiProperty({
        description: 'Список SKU. Используется, если файл не передан.',
        type: [String],
        required: false,
    })
    @IsOptional()
    @Transform(toStringList)
    skus?: string[];
}
