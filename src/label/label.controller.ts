import { Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import { GenerateBarcodeDto, GenerateLabelsDto, LabelService } from "./label.service";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response} from 'express';

@ApiTags('label')
@Controller('label')
export class LabelController {
    constructor(private readonly labelService: LabelService) {}

    @ApiOperation({ summary: 'Generate labels PDF' })
    @ApiBody({ type: GenerateLabelsDto, description: 'Data to generate labels PDF' })
    @ApiResponse({
        status: 200,
        description: 'PDF file with generated labels',
        content: {
            'application/pdf': {
                schema: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @Post('list')
    async getLabels(@Body() body: GenerateLabelsDto, @Res() res: Response) {
        const pdfBuffer = await this.labelService.generateLabels(body);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=labels.pdf');
        res.send(pdfBuffer);
    }

    @Get('generate')
    @ApiOperation({ summary: 'Генерация штрихкода' })
    @ApiResponse({
        status: 200,
        description: 'Успешная генерация штрихкода',
        content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
    })
    @ApiResponse({ status: 400, description: 'Неверные параметры запроса' })
    async generateBarcode(
        @Query() query: GenerateBarcodeDto,
        @Res() res: Response,
    ) {
        try {
            const barcodeBuffer = await this.labelService.generateBarcode(query);
            res.setHeader('Content-Type', 'image/png'); // Устанавливаем заголовок для изображения
            res.send(barcodeBuffer); // Отправляем изображение
        } catch (error) {
            res.status(500).send({ message: 'Error generating barcode' });
        }
    }

}
