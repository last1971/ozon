import { Body, Controller, Delete, Get, Inject, Param, ParseEnumPipe, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { AVITO_GOOD_STORE, IAvitoGoodStore } from '../interfaces/i.avito.good.store';
import { GoodPercentDto } from './dto/good.percent.dto';
import { ResultDto } from '../helpers/dto/result.dto';
import { GoodWbDto } from './dto/good.wb.dto';
import { GoodAvitoDto } from './dto/good.avito.dto';
import { ExtraGoodService } from './extra.good.service';
import { GoodServiceEnum } from './good.service.enum';
import { IsSwitchedDto } from './dto/is.switched.dto';
import { DisableGoodsDto } from './dto/disable.goods.dto';
import { DisabledCodeDto, GoodsServiceStatusDto, ServiceStatusDto } from './dto/good.status.dto';
import { IsEnum } from 'class-validator';
import { ProductInfoDto } from "../product/dto/product.info.dto";

class UpdateServiceParams {
    @IsEnum(GoodServiceEnum)
    @ApiProperty({
        description: 'service name',
        enum: GoodServiceEnum,
    })
    service: GoodServiceEnum;
}

@ApiTags('good')
@Controller('good')
export class GoodController {
    constructor(
        @Inject(GOOD_SERVICE) private goodService: IGood,
        @Inject(AVITO_GOOD_STORE) private avitoStore: IAvitoGoodStore,
        private extraService: ExtraGoodService,
    ) {}
    @Post('percent')
    async setPercent(@Query() percent: GoodPercentDto): Promise<void> {
        await this.goodService.setPercents(percent, null);
    }
    @Put('update/:service')
    async updateService(@Param() params: UpdateServiceParams): Promise<ResultDto> {
        return this.extraService.updateService(params.service);
    }
    @Put('wb')
    @ApiOperation({ summary: 'Установить данные Wildberries для товара' })
    @ApiBody({
        description: 'Данные товара для Wildberries',
        type: GoodWbDto,
        required: true,
    })
    @ApiResponse({
        status: 200,
        description: 'Данные успешно сохранены',
    })
    async setWb(@Body() dto: GoodWbDto): Promise<void> {
        await this.goodService.setWbData(dto, null);
    }

    @Put('avito')
    @ApiOperation({ summary: 'Установить данные Avito для товара' })
    @ApiBody({
        description: 'Данные товара для Avito',
        type: GoodAvitoDto,
        required: true,
    })
    @ApiResponse({
        status: 200,
        description: 'Данные успешно сохранены',
    })
    async setAvito(@Body() dto: GoodAvitoDto): Promise<void> {
        await this.avitoStore.setAvitoData(dto, null);
    }

    @Post('avito/data')
    @ApiOperation({ summary: 'Получить данные Avito по списку ID' })
    @ApiBody({
        description: 'Список ID товаров в Avito',
        schema: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    example: ['avito123', 'avito456'],
                    description: 'Список ID товаров в Avito',
                },
            },
            required: ['ids'],
        },
    })
    @ApiResponse({
        status: 200,
        description: 'Данные товаров Avito',
        type: [GoodAvitoDto],
    })
    async getAvitoData(@Body('ids') ids: string[]): Promise<GoodAvitoDto[]> {
        return this.avitoStore.getAvitoData(ids);
    }

    @Post('is-switched')
    async isSwitched(@Query() isSwitchedDto: IsSwitchedDto): Promise<ResultDto> {
        return this.extraService.serviceIsSwitchedOn(isSwitchedDto);
    }

    @Post('disable')
    @ApiOperation({ summary: 'Отключить товары (обнулить остаток) по списку SKU или xlsx' })
    @ApiConsumes('multipart/form-data', 'application/json')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['service', 'level'],
            properties: {
                service: { type: 'string', enum: Object.values(GoodServiceEnum) },
                level: { type: 'string', enum: ['good', 'sku'], description: 'good → весь товар (GOODSCODE); sku → точная фасовка' },
                skus: { type: 'array', items: { type: 'string' }, description: 'Список SKU (если без файла)' },
                file: { type: 'string', format: 'binary', description: 'xlsx со столбцом «SKU»' },
            },
        },
    })
    @UseInterceptors(FileInterceptor('file'))
    async disable(
        @Body() dto: DisableGoodsDto,
        @UploadedFile('file') file?: Express.Multer.File,
    ): Promise<ResultDto> {
        const skus = file ? await this.extraService.skusFromFile(file.buffer) : (dto.skus ?? []);
        return this.extraService.disable(dto.service, skus, dto.level);
    }

    @Post('enable')
    @ApiOperation({ summary: 'Включить товары (снять заморозку, вернуть склад) по списку SKU или xlsx' })
    @ApiConsumes('multipart/form-data', 'application/json')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['service', 'level'],
            properties: {
                service: { type: 'string', enum: Object.values(GoodServiceEnum) },
                level: { type: 'string', enum: ['good', 'sku'], description: 'good → весь товар (GOODSCODE); sku → точная фасовка' },
                skus: { type: 'array', items: { type: 'string' }, description: 'Список SKU (если без файла)' },
                file: { type: 'string', format: 'binary', description: 'xlsx со столбцом «SKU»' },
            },
        },
    })
    @UseInterceptors(FileInterceptor('file'))
    async enable(
        @Body() dto: DisableGoodsDto,
        @UploadedFile('file') file?: Express.Multer.File,
    ): Promise<ResultDto> {
        const skus = file ? await this.extraService.skusFromFile(file.buffer) : (dto.skus ?? []);
        return this.extraService.enable(dto.service, skus, dto.level);
    }

    @Get('services')
    @ApiOperation({ summary: 'Список сервисов и их состояние вкл/выкл' })
    @ApiResponse({ status: 200, type: [ServiceStatusDto] })
    listServices(): ServiceStatusDto[] {
        return this.extraService.listServices();
    }

    @Get('disabled/:service')
    @ApiOperation({ summary: 'Замороженные коды сервиса (весь товар / фасовка)' })
    @ApiParam({ name: 'service', enum: GoodServiceEnum })
    @ApiResponse({ status: 200, type: [DisabledCodeDto] })
    getDisabled(
        @Param('service', new ParseEnumPipe(GoodServiceEnum)) service: GoodServiceEnum,
    ): Promise<DisabledCodeDto[]> {
        return this.extraService.getDisabled(service);
    }

    @Delete('disabled/:service')
    @ApiOperation({ summary: 'Разморозить ВСЁ: снять все блокировки сервиса и вернуть склад' })
    @ApiParam({ name: 'service', enum: GoodServiceEnum })
    @ApiResponse({ status: 200, type: ResultDto })
    enableAll(
        @Param('service', new ParseEnumPipe(GoodServiceEnum)) service: GoodServiceEnum,
    ): Promise<ResultDto> {
        return this.extraService.enableAll(service);
    }

    @Get('status/:service')
    @ApiOperation({ summary: 'Сводка по сервису: вкл/выкл + активные/замороженные SKU' })
    @ApiParam({ name: 'service', enum: GoodServiceEnum })
    @ApiResponse({ status: 200, type: GoodsServiceStatusDto })
    getStatus(
        @Param('service', new ParseEnumPipe(GoodServiceEnum)) service: GoodServiceEnum,
    ): Promise<GoodsServiceStatusDto> {
        return this.extraService.getStatus(service);
    }

    @Post('load-sku-list/:service')
    async loadSkuList(@Param() params: UpdateServiceParams): Promise<ResultDto> {
        return this.extraService.loadSkuList(params.service);
    }

    @Post('info/:service')
    @ApiOperation({ summary: 'Получить информацию о продуктах по списку SKU' })
    @ApiParam({
        name: 'service',
        enum: GoodServiceEnum, // Укажите enum для автоподстановки
        description: 'Название сервиса',
    })
    @ApiBody({
        description: 'Список SKU для получения информации о продуктах',
        schema: {
            type: 'object',
            properties: {
                skus: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    example: ['SKU123', 'SKU456'],
                },
            },
        },
        required: true,
    })
    @ApiResponse({
        status: 200,
        description: 'Информация о продуктах',
        type: [ProductInfoDto],
    })
    async getInfo(
        @Param('service', new ParseEnumPipe(GoodServiceEnum)) service: GoodServiceEnum,
        @Body('skus') skus: string[]
    ): Promise<ProductInfoDto[]> {
        return this.extraService.getProductInfo(skus, service);
    }

    @Post('change-count')
    @ApiOperation({ summary: 'Получить информацию о продуктах по списку SKU' })
    @ApiBody({
        description: 'Список SKU для обновления',
        schema: {
            type: 'object',
            properties: {
                skus: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    example: ['SKU123', 'SKU456'],
                },
            },
        },
        required: true,
    })
    @ApiResponse({
        status: 201,
        description: 'Обновлено',
    })
    async changeCount(@Body('skus') skus: string[]): Promise<void> {
        const goods = await this.goodService.in(skus, null);
        await this.extraService.countsChanged(goods);
    }

    @Get('sku-list/:service')
    @ApiOperation({ summary: 'Получить список всех SKU для указанного сервиса' })
    @ApiParam({
        name: 'service',
        enum: GoodServiceEnum,
        description: 'Название сервиса (OZON, WB, YANDEX, EXPRESS, AVITO)',
        example: GoodServiceEnum.OZON
    })
    @ApiResponse({
        status: 200,
        description: 'Список SKU',
        schema: {
            type: 'array',
            items: {
                type: 'string',
            },
            example: ['SKU123', 'SKU456', 'SKU789']
        }
    })
    async getSkuList(
        @Param('service', new ParseEnumPipe(GoodServiceEnum)) service: GoodServiceEnum
    ): Promise<string[]> {
        return this.extraService.getSkuList(service);
    }

    @Post('import-wb')
    @ApiOperation({ summary: 'Импорт данных WB из XLSX (столбцы: id, commission, tariff, minPrice, wbCategoriesId)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
    @UseInterceptors(FileInterceptor('file'))
    async importWb(@UploadedFile() file: Express.Multer.File) {
        return this.extraService.importWbFromXlsx(file.buffer);
    }

    @Post('import-avito')
    @ApiOperation({ summary: 'Импорт данных Avito из XLSX (столбцы: id, goodsCode, coeff, commission)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
    @UseInterceptors(FileInterceptor('file'))
    async importAvito(@UploadedFile() file: Express.Multer.File) {
        return this.extraService.importAvitoFromXlsx(file.buffer);
    }

    @Post('import-percent')
    @ApiOperation({ summary: 'Импорт наценок из XLSX (столбцы: offer_id, min_perc, perc, old_perc, adv_perc, packing_price, available_price)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
    @UseInterceptors(FileInterceptor('file'))
    async importPercent(@UploadedFile() file: Express.Multer.File) {
        return this.extraService.importPercentFromXlsx(file.buffer);
    }
}
