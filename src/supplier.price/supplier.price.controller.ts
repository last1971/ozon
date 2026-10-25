import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupplierPriceService } from './supplier.price.service';
import { SupplierPriceRequestDto } from './dto/supplier.price.request.dto';
import { SupplierPriceResponseDto } from './dto/supplier.price.response.dto';

@ApiTags('supplier-price')
@Controller('supplier/price')
export class SupplierPriceController {
    constructor(private readonly service: SupplierPriceService) {}

    @Post()
    @ApiOperation({
        summary: 'Цены товаров поставщиков для сайта',
        description:
            'Пачка строк (поставщик, цена в его валюте, ступени) и курсы ЦБ → рубли: цена, зачёркнутая, минимальная, ступени. ' +
            'Валюта, доставка и наценка — свои у каждого поставщика; наценка по умолчанию как у наших товаров на сайте.',
    })
    @ApiBody({ type: SupplierPriceRequestDto })
    @ApiOkResponse({ type: SupplierPriceResponseDto })
    async calculate(@Body() request: SupplierPriceRequestDto): Promise<SupplierPriceResponseDto> {
        return this.service.calculate(request);
    }
}
