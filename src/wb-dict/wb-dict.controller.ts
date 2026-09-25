import { BadRequestException, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JobStateDto } from '../job/job.state.dto';
import { WbDictService } from './wb-dict.service';
import { WbDictStats } from './wb-categories.repository';
import { WbTnvedLookup } from './wb-tnved-map.service';

@ApiTags('wb-dict')
@Controller('wb-dict')
export class WbDictController {
    constructor(private readonly service: WbDictService) {}

    @Post('categories')
    @ApiOperation({
        summary: 'Обновить предметы и комиссии ВБ (фоном)',
        description: 'tariffs/commission → WB_CATEGORIES. Справочник ТН ВЭД не трогает. Ход — GET /api/job/{id}.',
    })
    @ApiOkResponse({ type: JobStateDto })
    categories(@Headers('x-client-id') clientId?: string): JobStateDto {
        return this.service.startCategories(clientId || undefined);
    }

    @Post('tnved')
    @ApiOperation({
        summary: 'Обновить справочник ТН ВЭД по предметам ВБ (фоном)',
        description:
            'directory/tnved на каждый предмет → WB_CATEGORIES.TNVED_LIST, потом пересборка карты «код → предметы». ' +
            'По умолчанию только предметы без справочника и с устаревшим (WB_TNVED_STALE_DAYS); all=true — все. ' +
            'Раз в секунду, ~7500 предметов — около двух часов; упало или убили — запустить снова, докачает остаток.',
    })
    @ApiQuery({ name: 'all', required: false, description: 'true = все предметы заново' })
    @ApiOkResponse({ type: JobStateDto })
    tnved(@Query('all') all?: string, @Headers('x-client-id') clientId?: string): JobStateDto {
        return this.service.startTnved(all === 'true' || all === '1', clientId || undefined);
    }

    @Get('stats')
    @ApiOperation({ summary: 'Сколько предметов, у скольких есть справочник ТН ВЭД, сколько ждёт выкачки' })
    stats(): Promise<WbDictStats> {
        return this.service.stats();
    }

    @Get('subjects')
    @ApiOperation({
        summary: 'Предметы ВБ, где проходит код ТН ВЭД',
        description: 'Точное совпадение; нет — по началу кода (6, затем 4 знака), match говорит, как нашли. Сортировка по комиссии.',
    })
    @ApiQuery({ name: 'tnved', required: true, description: 'код ТН ВЭД, 10 знаков (можно короче — поиск по началу)' })
    subjects(@Query('tnved') tnved?: string): Promise<WbTnvedLookup> {
        const code = String(tnved ?? '').replace(/\D/g, '');
        if (code.length < 4) throw new BadRequestException('tnved: нужно хотя бы 4 знака кода');
        return this.service.find(code);
    }
}
