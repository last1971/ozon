import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MpService } from '../mp-event/mp-event.service';
import { MpReturnService } from './mp-return.service';
import { ReturnCardDto, ReturnRowDto } from './dto/return-card.dto';
import { AcceptReturnDto, ReturnActionResultDto, WriteOffReturnDto } from './dto/return-request.dto';

@ApiTags('mp-return')
@Controller('mp-return')
export class MpReturnController {
    constructor(private readonly service: MpReturnService) {}

    @Get()
    @ApiOperation({ summary: 'Возвраты, отмеченные маркетплейсом полученными нами, за период (по умолчанию 14 дней)' })
    @ApiQuery({ name: 'service', enum: ['OZON', 'WB', 'YANDEX'] })
    @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
    @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
    @ApiQuery({ name: 'onlyPending', required: false, description: 'true — только непринятые (по умолчанию)' })
    @ApiOkResponse({ type: [ReturnRowDto] })
    list(
        @Query('service') service: MpService,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('onlyPending') onlyPending?: string,
    ): Promise<ReturnRowDto[]> {
        return this.service.list(service, from, to, onlyPending !== 'false');
    }

    @Get('lookup')
    @ApiOperation({ summary: 'Карточки возврата по скану: этикетка ii…, номер отправления, заказа или id возврата' })
    @ApiQuery({ name: 'service', enum: ['OZON', 'WB', 'YANDEX'] })
    @ApiQuery({ name: 'q' })
    @ApiOkResponse({ type: [ReturnCardDto] })
    lookup(@Query('service') service: MpService, @Query('q') q: string): Promise<ReturnCardDto[]> {
        return this.service.lookup(service, q ?? '');
    }

    @Get('write-off-reasons')
    @ApiOperation({ summary: 'Основания списания (OSN_SPIS) без переносов склад↔магазин' })
    reasons(): Promise<{ id: number; name: string }[]> {
        return this.service.reasons();
    }

    @Post(':service/:extId/accept')
    @ApiOperation({
        summary: 'Решение по строке возврата: вернуть / вернуть и списать / проблема',
        description: 'Одна транзакция: отказ любого шага откатывает всё, включая приём при «вернуть и списать».',
    })
    @ApiParam({ name: 'service', enum: ['OZON', 'WB', 'YANDEX'] })
    @ApiParam({ name: 'extId', description: 'id возврата у маркетплейса' })
    @ApiBody({ type: AcceptReturnDto })
    @ApiOkResponse({ type: ReturnActionResultDto })
    accept(
        @Param('service') service: MpService,
        @Param('extId') extId: string,
        @Body() body: AcceptReturnDto,
    ): Promise<ReturnActionResultDto> {
        return this.service.accept(service, extId, body);
    }

    @Post(':service/:extId/write-off')
    @ApiOperation({ summary: 'Списать ранее принятую строку возврата (марки — те, что сканировали при приёме)' })
    @ApiParam({ name: 'service', enum: ['OZON', 'WB', 'YANDEX'] })
    @ApiParam({ name: 'extId' })
    @ApiBody({ type: WriteOffReturnDto })
    @ApiOkResponse({ type: ReturnActionResultDto })
    writeOff(
        @Param('service') service: MpService,
        @Param('extId') extId: string,
        @Body() body: WriteOffReturnDto,
    ): Promise<ReturnActionResultDto> {
        return this.service.writeOff(service, extId, body);
    }
}
