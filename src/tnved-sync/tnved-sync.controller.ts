import { Controller, Delete, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GoodServiceEnum } from '../good/good.service.enum';
import { TnvedSyncReport, TnvedSyncService } from './tnved-sync.service';

@ApiTags('tnved-sync')
@Controller('tnved-sync')
export class TnvedSyncController {
    constructor(private readonly service: TnvedSyncService) {}

    @Post()
    @ApiOperation({
        summary: 'Сверить ТН ВЭД товаров базы с маркетплейсом и (опц.) поправить',
        description:
            'Берёт из базы товары с ТН ВЭД, сверяет с карточками маркетплейса и делит на «уже ок» / «на правку» / ' +
            '«нет карточки» / «спорно, руками» (с причиной). apply=false (по умолчанию) — только отчёт, ничего не пишет. ' +
            'Озон: ставит вариант ТН ВЭД + «Нужен код маркировки» по MARK_REQUIRED. ВБ: пока только чтение.',
    })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum, description: 'маркетплейс: ozon | wb' })
    @ApiQuery({ name: 'apply', required: false, description: 'true = писать на маркетплейс; иначе dry-run' })
    @ApiQuery({ name: 'offer', required: false, description: 'ограничить одним goodscode (обкатка)' })
    @ApiQuery({ name: 'limit', required: false, description: 'ограничить количество товаров (с onlyNew — следующие N необработанных)' })
    @ApiQuery({ name: 'onlyNew', required: false, description: 'true = пропустить товары, уже помеченные обработанными' })
    @ApiOkResponse({ description: 'Отчёт: что поправлено/уже ок/не найдено/спорно' })
    async run(
        @Query('market') market: GoodServiceEnum,
        @Query('apply') apply?: string,
        @Query('offer') offer?: string,
        @Query('limit') limit?: string,
        @Query('onlyNew') onlyNew?: string,
    ): Promise<TnvedSyncReport> {
        return this.service.sync({
            market,
            apply: apply === 'true' || apply === '1',
            offer: offer || undefined,
            limit: limit ? Number(limit) : undefined,
            onlyNew: onlyNew === 'true' || onlyNew === '1',
        });
    }

    @Delete('progress')
    @ApiOperation({ summary: 'Сбросить прогресс раскатки ТН ВЭД по маркетплейсу (следующий onlyNew-прогон — с нуля)' })
    @ApiQuery({ name: 'market', required: true, enum: GoodServiceEnum })
    async clearProgress(@Query('market') market: GoodServiceEnum): Promise<{ market: GoodServiceEnum; cleared: true }> {
        await this.service.clearProgress(market);
        return { market, cleared: true };
    }
}
