import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddRemoveProductToActionsParamsDto {
    @ApiProperty({
        description: 'Массив идентификаторов товаров',
        type: [String],
        required: true,
    })
    @IsArray()
    @IsString({ each: true })
    ids: string[];

    @ApiProperty({
        description: 'Лимит товаров в одном запросе',
        type: Number,
        required: false,
        default: 100,
    })
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @IsOptional()
    chunkLimit?: number = 100;
} 