import { Controller, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TnvedSyncReport, TnvedSyncService } from './tnved-sync.service';

@ApiTags('tnved-sync')
@Controller('tnved-sync')
export class TnvedSyncController {
    constructor(private readonly service: TnvedSyncService) {}

    @Post()
    @ApiOperation({
        summary: 'Сверить ТНВЭД маркируемых товаров с Озоном и (опц.) поправить',
        description:
            'Берёт из базы товары с MARK_REQUIRED=1 и ТНВЭД, сверяет с карточкой Озона; ' +
            'где отсутствует/не совпадает — ставит наш ТНВЭД (вариант «МАРКИРОВКА РФ») и включает «Нужен код маркировки». ' +
            'apply=false (по умолчанию) — только отчёт, ничего не пишет.',
    })
    @ApiQuery({ name: 'apply', required: false, description: 'true = писать на Озон; иначе dry-run' })
    @ApiQuery({ name: 'offer', required: false, description: 'ограничить одним offer_id (обкатка)' })
    @ApiQuery({ name: 'limit', required: false, description: 'ограничить количество товаров' })
    @ApiOkResponse({ description: 'Отчёт: что поправлено/уже ок/не найдено/спорно' })
    async run(
        @Query('apply') apply?: string,
        @Query('offer') offer?: string,
        @Query('limit') limit?: string,
    ): Promise<TnvedSyncReport> {
        return this.service.sync({
            apply: apply === 'true' || apply === '1',
            offer: offer || undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }
}
