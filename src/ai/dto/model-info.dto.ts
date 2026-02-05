import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AIProviderName } from '../interfaces';

export class ModelInfoDto {
    @ApiProperty({ description: 'ID модели' })
    id: string;

    @ApiProperty({ description: 'Название модели' })
    name: string;

    @ApiProperty({ enum: AIProviderName, description: 'Провайдер' })
    provider: AIProviderName;

    @ApiPropertyOptional({ description: 'Максимум токенов' })
    maxTokens?: number;

    @ApiPropertyOptional({ description: 'Стоимость входных токенов за 1M' })
    inputCostPer1M?: number;

    @ApiPropertyOptional({ description: 'Стоимость выходных токенов за 1M' })
    outputCostPer1M?: number;
}
