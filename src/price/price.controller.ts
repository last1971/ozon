import { Body, Controller, forwardRef, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PriceRequestDto } from './dto/price.request.dto';
import { PricePresetDto } from './dto/price.preset.dto';
import { PriceService } from './price.service';
import { PriceResponseDto } from './dto/price.response.dto';
import { UpdatePricesDto } from './dto/update.price.dto';
import { YandexPriceService } from '../yandex.price/yandex.price.service';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { WbPriceService } from '../wb.price/wb.price.service';
@ApiTags('price')
@Controller('api/price')
export class PriceController {
    private services: Map<string, IPriceUpdateable>;
    constructor(
        private service: PriceService,
        @Inject(forwardRef(() => YandexPriceService)) private yandexPriceService: YandexPriceService,
        private wb: WbPriceService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
    ) {
        this.services = new Map<string, IPriceUpdateable>();
        this.services.set('yandex', yandexPriceService);
        this.services.set('ozon', service);
        this.services.set('wb', wb);
    }
    @ApiOkResponse({
        description: 'Получить информацию о ценах товаров',
        type: PriceResponseDto,
    })
    @Get()
    async list(@Query() priceRequest: PriceRequestDto): Promise<PriceResponseDto> {
        return this.service.index(priceRequest);
    }
    @ApiOkResponse({
        description: 'Получить настройки цен товаров',
        type: PricePresetDto,
    })
    @Get('preset')
    async preset(): Promise<PricePresetDto> {
        return this.service.preset();
    }
    @ApiOkResponse({
        description: 'Обновить цены',
    })
    @Post()
    async update(@Body() prices: UpdatePricesDto): Promise<any> {
        const skus = prices.prices.map((price) => price.offer_id);
        return Promise.all(
            Array.from(this.services.values()).map((service) => this.goodService.updatePriceForService(service, skus)),
        );
    }
    @Post('all/:service')
    async updatePrices(@Param('service') service: string): Promise<any> {
        const command = this.services.get(service) || this.service;
        return command.updateAllPrices();
    }
}
