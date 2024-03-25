import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ProductVisibilityInterface, ProductVisibilityValues, ProductVisibilityClass } from './product.visibility';

@ApiTags('product')
@Controller('product')
export class ProductController {
    @ApiOkResponse({
        description: 'Получить информацию о ценах товаров',
        type: ProductVisibilityClass,
    })
    @Get('visibility')
    visibility(): ProductVisibilityInterface {
        return ProductVisibilityValues;
    }
}
