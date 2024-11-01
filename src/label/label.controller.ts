import { Body, Controller, Post, Res } from "@nestjs/common";
import { GenerateLabelsDto, LabelService } from "./label.service";
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
    @Post()
    async getLabels(@Body() body: GenerateLabelsDto, @Res() res: Response) {
        const pdfBuffer = await this.labelService.generateLabels(body);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=labels.pdf');
        res.send(pdfBuffer);
    }
}
