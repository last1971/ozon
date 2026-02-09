import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UsageDto {
    @ApiProperty({ description: 'Входные токены' })
    input_tokens: number;

    @ApiProperty({ description: 'Выходные токены' })
    output_tokens: number;
}

export class ChatResponseDto {
    @ApiProperty({ description: 'Ответ модели' })
    content: string;

    @ApiProperty({ description: 'Использованная модель' })
    model: string;

    @ApiProperty({ type: UsageDto, description: 'Использование токенов' })
    usage: UsageDto;

    @ApiProperty({ description: 'Причина завершения' })
    finish_reason: string;

    @ApiPropertyOptional({ description: 'Токены на создание кэша (Anthropic)' })
    cache_creation_input_tokens?: number;

    @ApiPropertyOptional({ description: 'Токены из кэша (Anthropic)' })
    cache_read_input_tokens?: number;
}
