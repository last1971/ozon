import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class ActionProductsPageParamsDto {
    @ApiProperty({ description: 'Идентификатор акции' })
    @Type(() => Number)
    @IsNumber()
    action_id: number;

    @ApiProperty({ description: 'Идентификатор последнего товара предыдущей страницы', required: false })
    @IsOptional()
    @IsString()
    last_id?: string;
}
