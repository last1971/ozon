import { Controller, Delete, Headers, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GoodServiceEnum } from '../good/good.service.enum';
import { TnvedSyncService } from './tnved-sync.service';
import { JobStateDto } from '../job/job.state.dto';

@ApiTags('tnved-sync')
@Controller('tnved-sync')
export class TnvedSyncController {
    constructor(private readonly service: TnvedSyncService) {}

    @Post()
    @ApiOperation({
        summary: 'Запустить сверку ТН ВЭД с маркетплейсом (фоном) и (опц.) правку',
        description:
            'Берёт из базы товары с ТН ВЭД, сверяет с карточками маркетплейса и делит на «уже ок» / «на правку» / ' +
            '«нет карточки» / «спорно, руками» (с причиной). apply=false (по умолчанию) — только отчёт, ничего не пишет. ' +
            'Озон: вариант ТН ВЭД + «Нужен код маркировки» по MARK_REQUIRED; ВБ: характеристика ТНВЭД + needKiz/kizMarked. ' +
            'Отвечает сразу состоянием задачи; ход и отчёт — GET /api/job/{id}. Та же задача с теми же параметрами уже идёт — вернётся она.',
    })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum, description: 'маркетплейс: ozon | wb' })
    @ApiQuery({ name: 'apply', required: false, description: 'true = писать на маркетплейс; иначе dry-run' })
    @ApiQuery({ name: 'offer', required: false, description: 'ограничить одним goodscode (обкатка)' })
    @ApiQuery({ name: 'limit', required: false, description: 'ограничить количество товаров (с onlyNew — следующие N необработанных)' })
    @ApiQuery({ name: 'onlyNew', required: false, description: 'true = пропустить товары, уже помеченные обработанными' })
    @ApiOkResponse({ type: JobStateDto, description: 'Состояние запущенной задачи; result по завершении — отчёт' })
    run(
        @Query('market') market: GoodServiceEnum,
        @Query('apply') apply?: string,
        @Query('offer') offer?: string,
        @Query('limit') limit?: string,
        @Query('onlyNew') onlyNew?: string,
        @Headers('x-client-id') clientId?: string,
    ): JobStateDto {
        return this.service.start(
            {
                market,
                apply: apply === 'true' || apply === '1',
                offer: offer || undefined,
                limit: limit ? Number(limit) : undefined,
                onlyNew: onlyNew === 'true' || onlyNew === '1',
            },
            clientId || undefined,
        );
    }

    @Post('missing')
    @ApiOperation({
        summary: '«Где у нас пусто»: карточки маркетплейса, у которых в базе ТН ВЭД не заполнен или товара нет (фоном)',
        description:
            'Каталог маркетплейса минус товары базы с ТН ВЭД. Два списка: «ТН ВЭД пуст» (товар есть — заполнять у нас) ' +
            'и «нет в базе» (кода нет вообще — привязка карточки). Отвечает состоянием задачи; результат — GET /api/job/{id}.',
    })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum })
    @ApiOkResponse({ type: JobStateDto })
    missing(@Query('market') market: GoodServiceEnum, @Headers('x-client-id') clientId?: string): JobStateDto {
        return this.service.startMissing(market, clientId || undefined);
    }

    @Delete('progress')
    @ApiOperation({ summary: 'Сбросить прогресс раскатки ТН ВЭД по маркетплейсу (следующий onlyNew-прогон — с нуля)' })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum })
    async clearProgress(@Query('market') market: GoodServiceEnum): Promise<{ market: GoodServiceEnum; cleared: true }> {
        await this.service.clearProgress(market);
        return { market, cleared: true };
    }
}
