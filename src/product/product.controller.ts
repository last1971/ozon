import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ProductVisibilityInterface, ProductVisibilityValues, ProductVisibilityClass } from './product.visibility';
import { ProductService } from "./product.service";

@ApiTags('product')
@Controller('product')
export class ProductController {
    constructor(private service: ProductService) {}
    @ApiOkResponse({
        description: 'Получить информацию о ценах товаров',
        type: ProductVisibilityClass,
    })
    @Get('visibility')
    visibility(): ProductVisibilityInterface {
        return ProductVisibilityValues;
    }
    @ApiOkResponse({
        description: 'Получить информацию о складах',
        type: 'example',
    })
    @Get('store')
    async store(): Promise<any> {
        return this.service.getStoreList();
    }
}
