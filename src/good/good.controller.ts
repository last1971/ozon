import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiProperty, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { GoodPercentDto } from './dto/good.percent.dto';
import { ResultDto } from '../helpers/result.dto';
import { GoodWbDto } from './dto/good.wb.dto';
import { ExtraGoodService } from './extra.good.service';
import { GoodServiceEnum } from './good.service.enum';
import { IsSwitchedDto } from './dto/is.switched.dto';
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
    async setWb(@Query() dto: GoodWbDto): Promise<void> {
        await this.goodService.setWbData(dto, null);
    }

    @Post('is-switched')
    async isSwitched(@Query() isSwitchedDto: IsSwitchedDto): Promise<ResultDto> {
        return this.extraService.serviceIsSwitchedOn(isSwitchedDto);
    }

    @Post('load-sku-list/:service')
    async loadSkuList(@Param() params: UpdateServiceParams): Promise<ResultDto> {
        return this.extraService.loadSkuList(params.service);
    }

    @Post('info')
    @ApiOperation({ summary: 'Получить информацию о продуктах по списку SKU' })
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
    async getInfo(@Body('skus') skus: string[]): Promise<ProductInfoDto[]> {
        return this.extraService.getProductInfo(skus);
    }
}
