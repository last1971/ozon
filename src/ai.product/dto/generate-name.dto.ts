import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateNameResponseDto {
    @ApiProperty({ description: 'Сгенерированное название' })
    name: string;

    @ApiPropertyOptional({ description: 'Использованные токены' })
    tokens_used?: number;

    @ApiPropertyOptional({ description: 'Стоимость запроса' })
    cost?: number;
}
