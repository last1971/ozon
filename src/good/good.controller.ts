import { Controller, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { GoodPercentDto } from './dto/good.percent.dto';
import { ResultDto } from '../helpers/result.dto';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { ProductService } from '../product/product.service';
import { ExpressOfferService } from '../yandex.offer/express.offer.service';
import { WbCardService } from '../wb.card/wb.card.service';
import { GoodWbDto } from "./dto/good.wb.dto";
@ApiTags('good')
@Controller('api/good')
export class GoodController {
    private services: Map<string, ICountUpdateable>;
    constructor(
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private expressOffer: ExpressOfferService,
        private yandexOffer: YandexOfferService,
        private ozonProduct: ProductService,
        private wbCard: WbCardService,
    ) {
        this.services = new Map<string, ICountUpdateable>();
        this.services.set('yandex', yandexOffer);
        this.services.set('ozon', ozonProduct);
        this.services.set('express', expressOffer);
        this.services.set('wb', wbCard);
    }
    @Post('percent')
    async setPercent(@Query() percent: GoodPercentDto): Promise<void> {
        await this.goodService.setPercents(percent);
    }
    @Put('update/:service')
    async updateService(@Param('service') service: string): Promise<ResultDto> {
        return {
            isSuccess: true,
            message: `Was updated ${await this.goodService.updateCountForService(
                this.services.get(service) || this.yandexOffer,
                '',
            )} offers in ${service}`,
        };
    }
    @Put('wb')
    async setWb(@Query() dto: GoodWbDto): Promise<void> {
        await this.goodService.setWbData(dto);
    }
}
