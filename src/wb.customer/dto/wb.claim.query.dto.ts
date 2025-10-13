import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class WbClaimQueryDto {
    @ApiProperty({
        description: 'Состояние заявки: false — на рассмотрении, true — в архиве',
        example: false,
        required: true,
        type: Boolean,
    })
    @IsBoolean()
    @Type(() => Boolean)
    is_archive: boolean;

    @ApiProperty({
        description: 'ID заявки (UUID)',
        example: 'fe3e9337-e9f9-423c-8930-946a8ebef80',
        required: false,
        type: String,
    })
    @IsOptional()
    @IsString()
    id?: string;

    @ApiProperty({
        description: 'Количество заявок в ответе. По умолчанию 50',
        example: 50,
        required: false,
        minimum: 1,
        maximum: 200,
        type: Number,
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(200)
    @Type(() => Number)
    limit?: number;

    @ApiProperty({
        description: 'После какого элемента выдавать данные. По умолчанию 0',
        example: 0,
        required: false,
        minimum: 0,
        type: Number,
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Type(() => Number)
    offset?: number;

    @ApiProperty({
        description: 'Артикул WB (nmID)',
        example: 196320101,
        required: false,
        type: Number,
    })
    @IsOptional()
    @IsInt()
    @Type(() => Number)
    nm_id?: number;
}
