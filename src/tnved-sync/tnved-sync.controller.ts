import { Controller, Delete, Headers, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GoodServiceEnum } from '../good/good.service.enum';
import { CardSyncService } from './card-sync.service';
import { JobStateDto } from '../job/job.state.dto';
import { CardSyncMode } from '../interfaces/i.card.sync';

/** Режим из query: пусто — ТН ВЭД (как было до режимов). */
const parseMode = (mode?: string): CardSyncMode =>
    mode === CardSyncMode.GTIN ? CardSyncMode.GTIN : CardSyncMode.TNVED;

@ApiTags('tnved-sync')
@Controller('tnved-sync')
export class TnvedSyncController {
    constructor(private readonly service: CardSyncService) {}

    @Post()
    @ApiOperation({
        summary: 'Запустить сверку карточек маркетплейса с базой (фоном) и (опц.) правку: ТН ВЭД или GTIN',
        description:
            'Берёт из базы товары режима, сверяет с карточками маркетплейса и делит на «уже ок» / «на правку» / ' +
            '«нет карточки» / «спорно, руками» (с причиной). apply=false (по умолчанию) — только отчёт, ничего не пишет. ' +
            'mode=tnved (по умолчанию). Озон: вариант ТН ВЭД + «Нужен код маркировки» по MARK_REQUIRED; ВБ: характеристика ТНВЭД + needKiz/kizMarked. ' +
            'mode=gtin: все GTIN товара из GOODS_CLASSIF — в баркоды карточки минимальной фасовки (Озон /v1/barcode/add, ВБ sizes[0].skus); ' +
            'баркоды только добавляются, снять их через API нельзя. ' +
            'Отвечает сразу состоянием задачи; ход и отчёт — GET /api/job/{id}. Та же задача с теми же параметрами уже идёт — вернётся она.',
    })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum, description: 'маркетплейс: ozon | wb' })
    @ApiQuery({
        name: 'mode',
        required: false,
        enum: CardSyncMode,
        description: 'что сверяем: tnved (по умолчанию) | gtin',
    })
    @ApiQuery({ name: 'apply', required: false, description: 'true = писать на маркетплейс; иначе dry-run' })
    @ApiQuery({ name: 'offer', required: false, description: 'ограничить одним goodscode (обкатка)' })
    @ApiQuery({
        name: 'limit',
        required: false,
        description: 'ограничить количество товаров (с onlyNew — следующие N необработанных)',
    })
    @ApiQuery({
        name: 'onlyNew',
        required: false,
        description: 'true = пропустить товары, уже помеченные обработанными',
    })
    @ApiOkResponse({ type: JobStateDto, description: 'Состояние запущенной задачи; result по завершении — отчёт' })
    run(
        @Query('market') market: GoodServiceEnum,
        @Query('mode') mode?: string,
        @Query('apply') apply?: string,
        @Query('offer') offer?: string,
        @Query('limit') limit?: string,
        @Query('onlyNew') onlyNew?: string,
        @Headers('x-client-id') clientId?: string,
    ): JobStateDto {
        return this.service.start(
            {
                mode: parseMode(mode),
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
    @ApiOperation({ summary: 'Сбросить прогресс раскатки режима по маркетплейсу (следующий onlyNew-прогон — с нуля)' })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum })
    @ApiQuery({ name: 'mode', required: false, enum: CardSyncMode, description: 'tnved (по умолчанию) | gtin' })
    async clearProgress(
        @Query('market') market: GoodServiceEnum,
        @Query('mode') mode?: string,
    ): Promise<{ market: GoodServiceEnum; mode: CardSyncMode; cleared: true }> {
        const m = parseMode(mode);
        await this.service.clearProgress(market, m);
        return { market, mode: m, cleared: true };
    }
}
