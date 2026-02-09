import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AIChatMessage } from '../interfaces';

export class ChatRequestDto {
    @ApiProperty({ type: [Object], description: 'Массив сообщений' })
    messages: AIChatMessage[];

    @ApiPropertyOptional({ description: 'Модель для использования', example: 'claude-sonnet-4-5-20250929' })
    model?: string;

    @ApiPropertyOptional({ description: 'Максимальное количество токенов' })
    max_tokens?: number;

    @ApiPropertyOptional({ description: 'Температура (0-1)' })
    temperature?: number;

    @ApiPropertyOptional({ description: 'Системный промпт' })
    system?: string;

    @ApiPropertyOptional({ description: 'Включить web search (Anthropic)', example: true })
    web_search?: boolean;
}
