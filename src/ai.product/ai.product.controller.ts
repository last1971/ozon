import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AIProductService } from './ai.product.service';
import { AIProviderName } from '../ai/interfaces';
import { GenerateNameResponseDto } from './dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class GenerateNameBodyDto {
    @ApiProperty({ description: 'Исходный текст товара (артикул, название, характеристики - всё в одной строке)', example: 'TDA7851L ( JSMICRO, JSMSEMI )' })
    text: string;

    @ApiPropertyOptional({ enum: AIProviderName, description: 'AI провайдер', default: AIProviderName.ANTHROPIC })
    provider?: AIProviderName;

    @ApiPropertyOptional({ description: 'Модель AI (зависит от провайдера)' })
    model?: string;
}

@ApiTags('AI Product')
@Controller('ai-product')
export class AIProductController {
    constructor(private aiProductService: AIProductService) {}

    @Post('generate-name')
    @ApiOperation({ summary: 'Сгенерировать название товара для Ozon' })
    async generateName(@Body() body: GenerateNameBodyDto): Promise<GenerateNameResponseDto> {
        return this.aiProductService.generateName(
            body.text,
            body.provider || AIProviderName.ANTHROPIC,
            body.model,
        );
    }
}
