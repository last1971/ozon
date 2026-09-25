import { BadRequestException, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GoodServiceEnum } from '../good/good.service.enum';
import { JobStateDto } from '../job/job.state.dto';
import { DictStats } from '../interfaces/i.tnved.dictionary';
import { DictService } from './dict.service';
import { TnvedLookup } from './tnved-map.service';

@ApiTags('dict')
@Controller('dict')
export class DictController {
    constructor(private readonly service: DictService) {}

    @Post('categories')
    @ApiOperation({
        summary: 'Обновить предметы (типы) и комиссии маркетплейса (фоном)',
        description: 'ВБ: tariffs/commission → WB_CATEGORIES; Озон: дерево категорий → OZON_CATEGORIES/OZON_TYPES. Справочник ТН ВЭД не трогает. Ход — GET /api/job/{id}.',
    })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum })
    @ApiOkResponse({ type: JobStateDto })
    categories(@Query('market') market: GoodServiceEnum, @Headers('x-client-id') clientId?: string): JobStateDto {
        return this.service.startCategories(market, clientId || undefined);
    }

    @Post('tnved')
    @ApiOperation({
        summary: 'Обновить справочник ТН ВЭД по предметам маркетплейса (фоном)',
        description:
            'На каждый предмет — справочник с маркетплейса (ВБ directory/tnved, Озон attribute/values) → TNVED_LIST, ' +
            'потом пересборка карты «код → предметы». По умолчанию только предметы без справочника и с устаревшим ' +
            '(WB_TNVED_STALE_DAYS); all=true — все. Упало или убили — запустить снова, докачает остаток.',
    })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum })
    @ApiQuery({ name: 'all', required: false, description: 'true = все предметы заново' })
    @ApiOkResponse({ type: JobStateDto })
    tnved(@Query('market') market: GoodServiceEnum, @Query('all') all?: string, @Headers('x-client-id') clientId?: string): JobStateDto {
        return this.service.startTnved(market, all === 'true' || all === '1', clientId || undefined);
    }

    @Get('stats')
    @ApiOperation({ summary: 'По каждому рынку: сколько предметов, у скольких есть справочник ТН ВЭД, сколько ждёт выкачки' })
    stats(): Promise<DictStats[]> {
        return this.service.stats();
    }

    @Get('subjects')
    @ApiOperation({
        summary: 'Предметы всех маркетплейсов, где проходит код ТН ВЭД',
        description: 'Ответ по каждому рынку: точное совпадение; нет — по началу кода (6, затем 4 знака), match говорит, как нашли. Сортировка по комиссии.',
    })
    @ApiQuery({ name: 'tnved', required: true, description: 'код ТН ВЭД, 10 знаков (можно короче — поиск по началу)' })
    subjects(@Query('tnved') tnved?: string): Promise<TnvedLookup[]> {
        const code = String(tnved ?? '').replace(/\D/g, '');
        if (code.length < 4) throw new BadRequestException('tnved: нужно хотя бы 4 знака кода');
        return this.service.find(code);
    }
}
