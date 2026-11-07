import { Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LossMarketsService } from './loss-markets.service';
import { LossReportService } from './loss-report.service';

@ApiTags('marketplace-loss')
@Controller('marketplace-loss')
export class LossReportController {
    constructor(
        private readonly markets: LossMarketsService,
        private readonly report: LossReportService,
    ) {}
    @Get()
    @ApiOperation({ summary: 'Подключённые площадки статистики потерь' })
    list() {
        return this.markets.list();
    }
    @Get(':service')
    @ApiOperation({ summary: 'Сохранённая статистика потерь; NULL — пересчёта ещё не было' })
    read(@Param('service') service: string) {
        return this.report.read(this.markets.require(service));
    }
    @Get(':service/:offerId/costs')
    @ApiOperation({ summary: 'Расходы на одну продажу существующей формулой, без отправки цен' })
    costs(@Param('service') service: string, @Param('offerId') offerId: string) {
        return this.report.costs(this.markets.require(service), offerId);
    }
    @Post(':service/recalculate')
    @HttpCode(202)
    @ApiOperation({
        summary: 'Пересчитать статистику и поставить изменения Ozon/ВБ в очередь цен; прогресс GET /api/job/{id}',
    })
    start(@Param('service') service: string, @Headers('x-client-id') clientId?: string) {
        return this.markets.start(service, clientId);
    }
}
