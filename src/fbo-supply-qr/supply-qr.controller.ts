import { Body, Controller, Delete, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { SupplyQrService } from './supply-qr.service';
import {
    BindQrDto,
    ResolvedProductDto,
    ResolveProductDto,
    SupplyBoundDto,
    SupplyTemplateDto,
} from './dto/supply-qr.dto';

const FILE_BODY = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };

@ApiTags('fbo-supply-qr')
@Controller('fbo-supply-qr')
export class SupplyQrController {
    constructor(private readonly service: SupplyQrService) {}

    @Post('template')
    @ApiOperation({ summary: 'Шаблон Озона «Состав грузомест»: коробки, артикулы и уже наклеенные этикетки' })
    @ApiConsumes('multipart/form-data')
    @ApiBody(FILE_BODY)
    @ApiOkResponse({ type: SupplyTemplateDto })
    @UseInterceptors(FileInterceptor('file'))
    template(@UploadedFile() file: Express.Multer.File): Promise<SupplyTemplateDto> {
        return this.service.template(file?.buffer);
    }

    @Post('resolve')
    @ApiOperation({ summary: 'Скан товара: есть ли в коробке и можно ли отправить (код ЧЗ — только продаваемый)' })
    @ApiOkResponse({ type: ResolvedProductDto })
    resolve(@Body() body: ResolveProductDto): Promise<ResolvedProductDto> {
        return this.service.resolve(body);
    }

    @Get('qr/:qr')
    @ApiOperation({ summary: 'Этикетка ii…: к чему уже привязана (пусто — свободна)' })
    @ApiOkResponse({ type: SupplyBoundDto })
    qr(@Param('qr') qr: string): Promise<SupplyBoundDto | null> {
        return this.service.qr(qr);
    }

    @Post('bind')
    @ApiOperation({ summary: 'Привязать этикетку к экземпляру товара в коробке' })
    @ApiOkResponse({ type: SupplyBoundDto })
    bind(@Body() body: BindQrDto): Promise<SupplyBoundDto> {
        return this.service.bind(body);
    }

    @Delete('qr/:qr')
    @ApiOperation({ summary: 'Отвязать этикетку' })
    async unbind(@Param('qr') qr: string): Promise<void> {
        await this.service.unbind(qr);
    }

    @Post('export')
    @ApiOperation({ summary: 'Тот же файл Озона с заполненным столбцом QR; X-Empty-Rows — строк без этикетки' })
    @ApiConsumes('multipart/form-data')
    @ApiBody(FILE_BODY)
    @UseInterceptors(FileInterceptor('file'))
    async export(@UploadedFile() file: Express.Multer.File, @Res() res: Response): Promise<void> {
        const { file: out, empty } = await this.service.export(file?.buffer);
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file?.originalname || 'qr.xlsx')}`,
            'Access-Control-Expose-Headers': 'X-Empty-Rows, Content-Disposition',
            'X-Empty-Rows': String(empty),
        });
        res.send(out);
    }
}
