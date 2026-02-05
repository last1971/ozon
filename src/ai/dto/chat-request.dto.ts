import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AIChatMessage } from '../interfaces';

export class ChatRequestDto {
    @ApiProperty({ type: [Object], description: 'Массив сообщений' })
    messages: AIChatMessage[];

    @ApiPropertyOptional({ description: 'Модель для использования' })
    model?: string;

    @ApiPropertyOptional({ description: 'Максимальное количество токенов' })
    max_tokens?: number;

    @ApiPropertyOptional({ description: 'Температура (0-1)' })
    temperature?: number;

    @ApiPropertyOptional({ description: 'Системный промпт' })
    system?: string;
}
