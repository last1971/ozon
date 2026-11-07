import { Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LossPriceUpdateService } from './loss-price-update.service';
import { LossPriceQueueStore } from './loss-price-queue.store';
@ApiTags('marketplace-loss')
@Controller('marketplace-loss/:service/prices')
export class LossPriceQueueController {
    constructor(
        private readonly worker: LossPriceUpdateService,
        private readonly queue: LossPriceQueueStore,
    ) {}
    @Get()
    @ApiOperation({ summary: 'Не завершённые обновления цен по статистике потерь' })
    pending(@Param('service') service: string) {
        return this.queue.pending(this.worker.require(service));
    }
    @Post()
    @HttpCode(202)
    @ApiOperation({ summary: 'Обработать очередь цен и акций; ошибки остаются для следующей попытки' })
    start(@Param('service') service: string, @Headers('x-client-id') clientId?: string) {
        return this.worker.start(service, clientId);
    }
}
