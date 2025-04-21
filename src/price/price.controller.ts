import {
    Body,
    Controller,
    Get,
    HttpException,
    Param,
    Post,
    Query,
    Res,
    UploadedFile,
    UseInterceptors
} from "@nestjs/common";
import {
    ApiBody,
    ApiConsumes,
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiQuery,
    ApiResponse,
    ApiTags
} from "@nestjs/swagger";
import { PriceRequestDto } from "./dto/price.request.dto";
import { PricePresetDto } from "./dto/price.preset.dto";
import { PriceService } from "./price.service";
import { PriceResponseDto } from "./dto/price.response.dto";
import { UpdatePriceDto, UpdatePricesDto } from "./dto/update.price.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { GoodServiceEnum } from "../good/good.service.enum";
import { IPriceable } from "../interfaces/i.priceable";
import { ObtainCoeffsDto } from "../helpers/obtain.coeffs.dto";
import { calculatePay, calculatePrice } from "../helpers";
import { WbCommissionDto } from "../wb.card/dto/wb.commission.dto";
import { ExtraPriceService } from "./extra.price.service";
import { WbPriceService } from "../wb.price/wb.price.service";

@ApiTags('price')
@Controller('price')
export class PriceController {
    constructor(
        private service: PriceService,
        private extraService: ExtraPriceService,
    ) {}
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
        const skus: string[] = [];
        const pricesMap = new Map<string, UpdatePriceDto>();
        prices.prices.forEach((price) => {
            skus.push(price.offer_id);
            pricesMap.set(price.offer_id, price);
        });
        return this.extraService.updatePriceForServices(skus, pricesMap);
    }
    @Post('all/:service')
    async updatePrices(@Param('service') service: GoodServiceEnum): Promise<any> {
        const command = this.extraService.getService(service) || this.service;
        return command.updateAllPrices();
    }
    @Post('calculate')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                price: {
                    type: 'object',
                    properties: {
                        offer_id: { type: 'string' },
                        incoming_price: { type: 'number' },
                        fbs_direct_flow_trans_max_amount: { type: 'number' },
                        sales_percent: { type: 'number' },
                        min_perc: { type: 'number' },
                        perc: { type: 'number' },
                        old_perc: { type: 'number' },
                        adv_perc: { type: 'number' },
                        sum_pack: { type: 'number' },
                        tax_unit: { type: 'number' },
                    },
                },
                percents: {
                    type: 'object',
                    properties: {
                        minMil: { type: 'number' },
                        percMil: { type: 'number' },
                        percEkv: { type: 'number' },
                        sumObtain: { type: 'number' },
                        sumLabel: { type: 'number' },
                    },
                },
            },
        },
    })
    async calculate(@Body() body: { price: IPriceable; percents: ObtainCoeffsDto }): Promise<UpdatePriceDto> {
        return calculatePrice(body.price, body.percents);
    }
    @Post('calculate-pay')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                price: {
                    type: 'object',
                    properties: {
                        offer_id: { type: 'string' },
                        incoming_price: { type: 'number' },
                        fbs_direct_flow_trans_max_amount: { type: 'number' },
                        sales_percent: { type: 'number' },
                        min_perc: { type: 'number' },
                        perc: { type: 'number' },
                        old_perc: { type: 'number' },
                        adv_perc: { type: 'number' },
                        sum_pack: { type: 'number' },
                        tax_unit: { type: 'number' },
                    },
                },
                percents: {
                    type: 'object',
                    properties: {
                        minMil: { type: 'number' },
                        percMil: { type: 'number' },
                        percEkv: { type: 'number' },
                        sumObtain: { type: 'number' },
                        sumLabel: { type: 'number' },
                    },
                },
                sums: { type: 'array', items: { type: 'number' } },
            },
        },
    })
    async calculatePay(
        @Body() body: { price: IPriceable; percents: ObtainCoeffsDto; sums: number[] },
    ): Promise<number[]> {
        return body.sums.map((sum) => calculatePay(body.price, body.percents, sum));
    }
    @Post('discount')
    @ApiConsumes('multipart/form-data')
    @ApiOkResponse({
        schema: {
            type: 'string',
            format: 'binary',
        },
    })
    @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
                service: {
                    type: 'string',
                    enum: [GoodServiceEnum.WB, GoodServiceEnum.YANDEX],
                },
            },
        },
    })
    @UseInterceptors(FileInterceptor('file'))
    async discount(
        @UploadedFile('file') file: Express.Multer.File,
        @Res() res: Response,
        @Body('service') service: GoodServiceEnum,
    ): Promise<any> {
        if ([GoodServiceEnum.WB, GoodServiceEnum.YANDEX].includes(service)) {
            const serviceCommand = this.extraService.getService(service);
            const buffer = await serviceCommand.createAction(file);
            res.contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.attachment(service + '-discount.xlsx');
            res.send(buffer);
        }
        throw new HttpException('Bad service', 400);
    }

    @Post('wb-coefficients')
    async updateWbCoeffs(): Promise<any> {
        await (this.extraService.getService(GoodServiceEnum.WB) as WbPriceService).updateWbSaleCoeffs();
    }

    @Get('wb-coefficients')
    async getWbCoeff(@Query('name') name: string): Promise<WbCommissionDto> {
        return this.extraService.getWbCoeff(name);
    }

    @Get('low-prices')
    @ApiOperation({ summary: 'Получить цены по низкой стоимости' })
    @ApiResponse({
        status: 200,
        description: 'Список предложений с низкими ценами',
        schema: {
            type: 'array',
            items: {
                type: 'string',
                example: 'offer1', // примеры ответа
            },
        },
    })
    @ApiQuery({
        name: 'minProfit',
        type: Number,
        description: 'Минимальная прибыль для фильтрации (опционально)',
        required: true, // Свойство делает параметр не обязательным
        example: 20,
    })
    @ApiQuery({
        name: 'minPercent',
        type: Number,
        description: 'Минимальный процент прибыли для фильтрации (опционально)',
        required: true,
        example: 10,
    })
    @ApiQuery({
        name: 'maxCount',
        type: Number,
        description: 'Максимальное количество результатов (опционально)',
        required: true,
        example: 5,
    })
    async getLowPrices(
        @Query('minProfit') minProfit: number, // Необязательный параметр
        @Query('minPercent') minPercent: number, // Необязательный параметр
        @Query('maxCount') maxCount: number, // Необязательный параметр
    ): Promise<string[]> {
        return this.service.getLowPrices(minProfit, minPercent, maxCount);
    }
}
