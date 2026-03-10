import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WbCardService } from './wb.card.service';
import { GenerateCharacteristicsDto } from './dto/generate-characteristics.dto';
import { CreateWbCardDto } from './dto/create-wb-card.dto';
import { UploadWbMediaDto } from './dto/upload-wb-media.dto';

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

    @Post('create')
    @ApiOperation({ summary: 'Создать карточку WB из Ozon' })
    async createCard(@Body() input: CreateWbCardDto) {
        const result = await this.wbCardService.createCard(input);
        if (result.stopChain && result.error_message) {
            return { error: true, error_message: result.error_message };
        }
        return {
            uploadBody: result.uploadBody,
            uploadResult: result.uploadResult,
            characteristics: result.characteristics,
            title: result.title,
            brand: result.brand,
            aiCost: result.aiCost,
        };
    }

    @Post('upload-media')
    @ApiOperation({ summary: 'Загрузить фото из Ozon в WB карточку' })
    async uploadMedia(@Body() input: UploadWbMediaDto) {
        return this.wbCardService.uploadMedia(input);
    }
}
