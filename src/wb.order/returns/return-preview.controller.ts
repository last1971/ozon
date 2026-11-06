import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WbReturnPreviewService } from './return-preview.service';

@ApiTags('price')
@Controller('price/losses/wb')
export class WbReturnPreviewController {
    constructor(private readonly preview: WbReturnPreviewService) {}
    @Post('preview')
    @HttpCode(202)
    @ApiOperation({
        summary:
            'Предварительный отчёт возвратов и списаний ВБ за 90 дней без изменения цен; прогресс GET /api/job/{id}',
    })
    start(@Headers('x-client-id') clientId?: string) {
        return this.preview.start(clientId);
    }
}
