import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WbCardService } from './wb.card.service';
import { GenerateCharacteristicsDto } from './dto/generate-characteristics.dto';

@ApiTags('WB Card')
@Controller('wb-card')
export class WbCardController {
    constructor(private readonly wbCardService: WbCardService) {}

    @Get('characteristics/:subjectId')
    @ApiOperation({ summary: 'Получить характеристики WB категории' })
    async getCharacteristics(@Param('subjectId') subjectId: number) {
        return this.wbCardService.getCharacteristics(Number(subjectId));
    }

    @Post('generate-characteristics')
    @ApiOperation({ summary: 'Сгенерировать характеристики WB через AI' })
    async generateCharacteristics(@Body() input: GenerateCharacteristicsDto) {
        const result = await this.wbCardService.generateCharacteristics(input);
        if (result.stopChain && result.error_message) {
            return { error: true, error_message: result.error_message };
        }
        return {
            characteristics: result.characteristics,
            cost: result.aiCost,
        };
    }
}
