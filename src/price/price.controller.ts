import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PriceRequestDto } from './dto/price.request.dto';
@ApiTags('price')
@Controller('api/price')
export class PriceController {
    @ApiOkResponse({
        description: 'Получить информацию о ценах товаров',
    })
    @Get()
    async list(@Query() priceRequest: PriceRequestDto): Promise<void> {}
}
